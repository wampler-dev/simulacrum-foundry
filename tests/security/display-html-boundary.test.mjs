import DOMPurify from '../../vendor/dompurify/purify.es.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

// Minimal Foundry globals permit exercising the sidebar display path in Node.
globalThis.FormApplication = class {};
globalThis.foundry = {
  applications: {
    sidebar: { AbstractSidebarTab: class {} },
    api: { HandlebarsApplicationMixin: Base => Base },
    ux: { TextEditor: { implementation: { enrichHTML: async html => html } } },
  },
  utils: { randomID: () => 'message-id' },
};
globalThis.game = { user: { isGM: true }, i18n: { localize: value => value } };
const { sanitizeDisplayHtml } = await import('../../scripts/utils/display-html.js');
const { MarkdownRenderer } = await import('../../scripts/lib/markdown-renderer.js');
const { processMessageForDisplay, createDisplayMessage } = await import('../../scripts/ui/sidebar-state-syncer.js');
const { SimulacrumSidebarTab } = await import('../../scripts/ui/simulacrum-sidebar-tab.js');

const payload = '<img src=x onerror="globalThis.attack()"><a href="javascript:attack()">click</a>';

test('HTML detected by markdown renderer is escaped before entering new and restored messages', async t => {
  const original = Object.getOwnPropertyDescriptor(DOMPurify, 'sanitize');
  delete DOMPurify.sanitize;
  t.after(() => {
    if (original) Object.defineProperty(DOMPurify, 'sanitize', original);
    else delete DOMPurify.sanitize;
  });
  assert.equal(await MarkdownRenderer.render(payload), payload);
  const rendered = await processMessageForDisplay(payload);
  assert.equal(rendered, payload);
  const newMessage = await createDisplayMessage('assistant', payload);
  assert.match(newMessage.display, /&lt;img/);
  assert.doesNotMatch(newMessage.display, /<img|<a /i);
  const restored = await createDisplayMessage('assistant', 'text', payload);
  assert.equal(restored.display, sanitizeDisplayHtml(payload));
});

test('failed or absent sanitizer falls back to encoded text', t => {
  const original = Object.getOwnPropertyDescriptor(DOMPurify, 'sanitize');
  t.after(() => {
    if (original) Object.defineProperty(DOMPurify, 'sanitize', original);
    else delete DOMPurify.sanitize;
  });
  DOMPurify.sanitize = () => { throw new Error('unavailable'); };
  assert.match(sanitizeDisplayHtml(payload), /&lt;img/);
  assert.doesNotMatch(sanitizeDisplayHtml(payload), /<img/);
});

test('new message, streaming, and tool cards sanitize before their DOM sinks', async t => {
  const originalSanitizer = Object.getOwnPropertyDescriptor(DOMPurify, 'sanitize');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalSanitizer) Object.defineProperty(DOMPurify, 'sanitize', originalSanitizer);
    else delete DOMPurify.sanitize;
    for (const [key, descriptor] of [['document', originalDocument]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const received = [];
  const wrappers = [];
  DOMPurify.sanitize = html => { received.push(html); return '<p>clean</p>'; };
  globalThis.document = { createElement: () => {
    const wrapper = { dataset: {}, outerHTML: '<div>clean</div>' };
    wrappers.push(wrapper);
    return wrapper;
  } };
  const sidebar = Object.create(SimulacrumSidebarTab.prototype);
  sidebar.messages = [{ role: 'assistant', display: '' }];
  sidebar._messageQueue = { add: async work => work() };
  sidebar._getLastAssistantMessageContent = () => ({ appendChild: () => {} });
  sidebar._scrollToBottom = () => {};
  let appendedDisplay;
  sidebar._appendNewMessage = async (_role, _content, display) => { appendedDisplay = display; };
  await sidebar._addMessageImpl('assistant', 'text', payload, true);
  assert.equal(appendedDisplay, '<p>clean</p>');
  await sidebar._addMessageImpl('assistant', payload, null, true);
  assert.equal(appendedDisplay, '<p>clean</p>');
  const inserted = [];
  const content = {
    lastElementChild: { classList: { contains: () => true }, insertAdjacentHTML: (_where, html) => inserted.push(html) },
  };
  sidebar._appendChunkToContent(content, payload);
  assert.deepEqual(inserted, ['<p>clean</p>']);
  await sidebar._addPendingToolCard({ toolCallId: 'pending', toolName: 'read_document', justification: payload });
  await sidebar._addToolResultCard({ toolCallId: 'complete', toolName: 'read_document', formattedDisplay: payload });
  assert.deepEqual(wrappers.map(wrapper => wrapper.innerHTML), ['<p>clean</p>', '<p>clean</p>']);
  assert.ok(received.some(html => html.includes('tool-justification')));
  assert.ok(received.some(html => html === payload));
});

test('late cancelled tool result replaces its original card, never the newer turn', async t => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => originalDocument
    ? Object.defineProperty(globalThis, 'document', originalDocument)
    : delete globalThis.document);
  globalThis.document = { createElement: () => ({ dataset: {}, outerHTML: '<div>actual result</div>' }) };

  const oldContent = { appended: [], appendChild(node) { this.appended.push(node); } };
  const newContent = { appended: [], appendChild(node) { this.appended.push(node); } };
  const oldBubble = {
    dataset: { messageId: 'old' },
    querySelector: () => oldContent,
  };
  let removed = false;
  const pending = {
    dataset: { toolCallId: 'old-call' },
    closest: () => oldBubble,
    remove: () => { removed = true; },
  };
  const scroll = { querySelectorAll: selector => selector === '.chat-message'
    ? [oldBubble] : removed ? [] : [pending] };
  const sidebar = Object.create(SimulacrumSidebarTab.prototype);
  sidebar.element = { querySelector: () => scroll };
  sidebar.messages = [
    { id: 'old', role: 'assistant', display: '' },
    { id: 'new', role: 'assistant', display: '' },
  ];
  sidebar._toolCardOwners = new Map([['old-call', 'old'], ['rerendered-call', 'old']]);
  sidebar._messageQueue = { add: async work => work() };
  sidebar._getLastAssistantMessageContent = () => newContent;
  sidebar._scrollToBottom = () => {};

  await sidebar._addToolResultCard({
    toolCallId: 'old-call', toolName: 'read_document',
    formattedDisplay: '<strong>actual result</strong>', cancelled: true,
  });
  assert.equal(removed, true);
  assert.equal(oldContent.appended.length, 1);
  assert.equal(newContent.appended.length, 0);
  assert.match(sidebar.messages[0].display, /actual result/);
  assert.equal(sidebar.messages[1].display, '');

  // Stop rerenders the log and removes the pending spinner before completion.
  await sidebar._addToolResultCard({
    toolCallId: 'rerendered-call', toolName: 'read_document',
    formattedDisplay: 'actual after render', cancelled: true,
  });
  assert.equal(oldContent.appended.length, 2);
  assert.equal(newContent.appended.length, 0);

  await sidebar._addToolResultCard({
    toolCallId: 'missing-pending', toolName: 'read_document',
    formattedDisplay: 'late result', cancelled: true,
  });
  assert.equal(newContent.appended.length, 0);
});
