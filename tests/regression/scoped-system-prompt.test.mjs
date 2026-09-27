import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { buildSystemPrompt } = await import('../../scripts/core/system-prompt-builder.js');
const { SimulacrumCore } = await import('../../scripts/core/simulacrum-core.js');

const schema = name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });

test('native prompt avoids registry, macro inventory, obsolete tool names and loop mandate', async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = {
    settings: { get: (_scope, key) => key === 'legacyMode' ? false : '' },
    i18n: { localize: () => 'Simulacrum assistant' },
    macros: { forEach: () => { throw Error('must not enumerate macros'); } },
  };
  t.after(() => old ? Object.defineProperty(globalThis, 'game', old) : delete globalThis.game);
  const prompt = await buildSystemPrompt({ tools: [schema('read_document')] });
  assert.match(prompt, /Simulacrum assistant/);
  assert.match(prompt, /plain-language final answer ends the turn/);
  assert.doesNotMatch(prompt, /manage_task|document_read|Available Macros|MUST respond with a tool call|Available tool schemas/);
});

test('legacy outbound prompt contains only supplied schemas, including after compaction', async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const manager = SimulacrumCore.conversationManager;
  const client = SimulacrumCore.aiClient;
  globalThis.game = {
    settings: { get: (_scope, key) => key === 'legacyMode' ? true : '' },
    i18n: { localize: () => 'Simulacrum assistant' },
  };
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'game', old); else delete globalThis.game;
    SimulacrumCore.conversationManager = manager;
    SimulacrumCore.aiClient = client;
  });
  let prompts = [];
  SimulacrumCore.conversationManager = {
    rollingSummary: '', getMessages: () => [{ role: 'user', content: 'Read the actor' }],
    estimatePromptOverhead: () => 0,
    compactHistory: async () => {
      SimulacrumCore.conversationManager.rollingSummary = 'Condensed earlier turns';
      return 'compacted';
    },
  };
  SimulacrumCore.aiClient = {
    chat: async messages => {
      prompts.push(messages[0].content);
      return { choices: [{ message: { role: 'assistant', content: 'Done' } }] };
    },
  };
  // The existing compaction controller stops after its round budget.
  await SimulacrumCore.generateResponse(SimulacrumCore.conversationManager.getMessages(), { tools: [schema('read_document')] });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /read_document/);
  assert.match(prompts[0], /Condensed earlier turns/);
  assert.doesNotMatch(prompts[0], /create_document|execute_macro|manage_task|document_read|text-only responses are rejected/);
});

test('native provider receives scoped tools and no schema dump in the prompt', async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const manager = SimulacrumCore.conversationManager;
  const client = SimulacrumCore.aiClient;
  globalThis.game = { settings: { get: (_scope, key) => key === 'legacyMode' ? false : '' }, i18n: { localize: () => 'Simulacrum assistant' } };
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'game', old); else delete globalThis.game;
    SimulacrumCore.conversationManager = manager;
    SimulacrumCore.aiClient = client;
  });
  SimulacrumCore.conversationManager = null;
  let outbound;
  SimulacrumCore.aiClient = { chatWithSystem: async (_messages, getPrompt, tools) => {
    outbound = { prompt: getPrompt(), tools };
    return { choices: [{ message: { role: 'assistant', content: 'Done' } }] };
  } };
  await SimulacrumCore.generateResponse([{ role: 'user', content: 'Read' }], { tools: [schema('read_document')] });
  assert.deepEqual(outbound.tools.map(tool => tool.function.name), ['read_document']);
  assert.doesNotMatch(outbound.prompt, /Available tool schemas|create_document|execute_macro|manage_task/);
});
