import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import test from 'node:test';

// Uses the project's Playwright installation by default. An external installation
// can be selected explicitly for a checkout without development dependencies.
const { chromium } = await import(process.env.SIMULACRUM_PLAYWRIGHT_MODULE || '@playwright/test');
const root = resolve(import.meta.dirname, '../..');

test('bundled sanitizer renders sidebar content without a host DOMPurify global', async t => {
  const server = createServer(async (req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.setHeader('Content-Type', /\.(m?js)$/.test(path) ? 'text/javascript' : 'text/html');
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SIMULACRUM_CHROMIUM_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/templates/simulacrum/message.hbs`);
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '';
    delete globalThis.DOMPurify;
    globalThis.attackCount = 0;
    globalThis.attack = () => { globalThis.attackCount++; };
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
    const { sanitizeDisplayHtml } = await import('/scripts/utils/display-html.js');
    const { createDisplayMessage } = await import('/scripts/ui/sidebar-state-syncer.js');
    const { SimulacrumSidebarTab } = await import('/scripts/ui/simulacrum-sidebar-tab.js');
    const malicious = '<img src="x" onerror="attack()"><a href="javascript:attack()">bad</a>'
      + '<svg onload="attack()"></svg><script>attack()</script>';
    const card = '<div class="simulacrum-tool-call tool-success"><i class="fa-solid fa-circle-check"></i>'
      + '<span class="tool-action">Read Document</span><p><strong>Goblin Warrior</strong></p></div>';
    const markup = card + malicious;
    const mount = html => {
      const el = document.createElement('section');
      el.innerHTML = html;
      document.body.append(el);
      return el;
    };
    const created = await createDisplayMessage('assistant', markup);
    const restored = await createDisplayMessage('assistant', 'stored', markup);
    const first = mount(created.display);
    const second = mount(restored.display);
    const content = mount('');
    const sidebar = Object.create(SimulacrumSidebarTab.prototype);
    sidebar.messages = [{ role: 'assistant', display: '' }];
    const queued = [];
    sidebar._messageQueue = { add: work => { const p = work(); queued.push(p); return p; } };
    sidebar._getLastAssistantMessageContent = () => content;
    sidebar._scrollToBottom = () => {};
    let newDisplay;
    sidebar._appendNewMessage = async (_role, _content, display) => { newDisplay = display; };
    await sidebar._addMessageImpl('assistant', markup, null, true);
    const added = mount(newDisplay);
    sidebar._appendChunkToContent(content, '<p><strong>AC</strong></p>' + malicious);
    sidebar._appendChunkToContent(content, '<p>HP</p>' + malicious);
    sidebar._addPendingToolCard({ toolCallId: 'pending', toolName: 'read_document', justification: malicious });
    sidebar._addToolResultCard({ toolCallId: 'done', toolName: 'read_document', formattedDisplay: markup });
    await Promise.all(queued);
    const persisted = mount(sidebar.messages[0].display);
    const link = mount(sanitizeDisplayHtml('<a class="content-link" data-uuid="Actor.example" draggable="true">Actor</a>'));
    // Allow queued image events to run and inspect the actual inserted DOM.
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    return {
      hostSanitizerAbsent: globalThis.DOMPurify === undefined,
      cards: [first, second, added, persisted].map(el => !!el.querySelector('.simulacrum-tool-call strong')),
      streamParagraphs: content.querySelectorAll('.content-block.text p').length,
      pendingCard: !!content.querySelector('.pending-tool-inline .simulacrum-tool-call'),
      completedCard: !!content.querySelector('.tool-result .tool-action'),
      unsafeElements: document.querySelectorAll('script,svg,iframe').length,
      unsafeAttributes: [...document.querySelectorAll('*')].flatMap(el => [...el.attributes])
        .filter(attr => /^on/i.test(attr.name) || /^(href|src)$/i.test(attr.name) && /^javascript:/i.test(attr.value)).length,
      attacks: globalThis.attackCount,
      uuid: link.querySelector('a')?.dataset.uuid,
      idempotent: sanitizeDisplayHtml(created.display) === created.display,
    };
  });
  assert.equal(result.hostSanitizerAbsent, true);
  assert.deepEqual(result.cards, [true, true, true, true]);
  assert.equal(result.streamParagraphs, 2);
  assert.equal(result.pendingCard, true);
  assert.equal(result.completedCard, true);
  assert.equal(result.unsafeElements, 0);
  assert.equal(result.unsafeAttributes, 0);
  assert.equal(result.attacks, 0);
  assert.equal(result.uuid, 'Actor.example');
  assert.equal(result.idempotent, true);
});
