import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { ConversationManager } = await import('../../scripts/core/conversation.js');
const { SimulacrumCore } = await import('../../scripts/core/simulacrum-core.js');
const { executeToolCalls } = await import('../../scripts/core/tool-execution.js');
const { toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { toolPermissionManager } = await import('../../scripts/core/tool-permission-manager.js');
const { interactionLogger } = await import('../../scripts/core/interaction-logger.js');
const { ReadToolOutputTool } = await import('../../scripts/tools/read-tool-output.js');
const { MAX_RETAINED_OUTPUT_CHARS } = await import('../../scripts/utils/tool-output-bounds.js');

test('large output is bounded in history, UI callback, user flag, and reload', async t => {
  const previousGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const oldManager = SimulacrumCore.conversationManager;
  let saved;
  globalThis.game = {
    user: { setFlag: async (_scope, _world, state) => { saved = structuredClone(state); },
      getFlag: async () => saved },
  };
  t.after(() => {
    SimulacrumCore.conversationManager = oldManager;
    if (previousGame) Object.defineProperty(globalThis, 'game', previousGame);
    else delete globalThis.game;
  });
  t.mock.method(toolPermissionManager, 'isDestructive', () => false);
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  t.mock.method(interactionLogger, 'logToolResult', () => {});
  const raw = 'x'.repeat(200000);
  t.mock.method(toolRegistry, 'executeTool', async () => ({ result: { content: raw, display: 'Large result' } }));
  const conversation = new ConversationManager('user', 'world');
  SimulacrumCore.conversationManager = conversation;
  conversation.addMessage('assistant', '', [{ id: 'large-1', type: 'function', function: { name: 'search_documents', arguments: '{}' } }]);
  const callbacks = [];
  const outcomes = await executeToolCalls([{
    id: 'large-1', function: { name: 'search_documents', arguments: { query: 'wide', justification: 'Test' } },
  }], { conversationManager: conversation, currentToolSupport: true,
    onToolResult: async message => callbacks.push(message) });
  assert.equal(outcomes[0].success, true);
  assert.equal(saved.toolOutputBuffer.length, 1);
  assert.ok(saved.toolOutputBuffer[0][1].length < 65000);
  assert.match(saved.toolOutputBuffer[0][1], /truncated in storage/);
  const compacted = JSON.parse(saved.activeMessages.at(-1).content);
  assert.equal(compacted._compacted, true);
  assert.equal(compacted.storage_truncated, true);
  assert.ok(saved.activeMessages.at(-1).content.length < 2000);
  assert.ok(callbacks[0].content.length < 2000);
  assert.equal(JSON.parse(callbacks[0].content)._compacted, true);
  const restored = new ConversationManager('user', 'world');
  assert.equal(await restored.load(), true);
  assert.equal(restored.toolOutputBuffer.size, 1);
  SimulacrumCore.conversationManager = restored;
  const reader = new ReadToolOutputTool();
  const section = await reader.execute({ tool_call_id: 'large-1', start_char: 10001, end_char: 20000 });
  assert.equal(section.content.length, 10000);
  assert.equal(section.has_more, true);
  assert.equal((await reader.execute({ tool_call_id: 'large-1', start_line: 2, end_line: 2 })).content.includes('truncated in storage'), true);
});

test('buffer evicts oldest outputs and bounds oversized legacy saved entries', async t => {
  const previousGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const legacy = Array.from({ length: 8 }, (_, index) => [`old-${index}`, 'y'.repeat(200000)]);
  globalThis.game = { user: { getFlag: async () => ({ v: 2, activeMessages: [], rollingSummary: '', toolOutputBuffer: legacy }) } };
  t.after(() => {
    if (previousGame) Object.defineProperty(globalThis, 'game', previousGame);
    else delete globalThis.game;
  });
  const conversation = new ConversationManager('user', 'world');
  await conversation.load();
  assert.deepEqual([...conversation.toolOutputBuffer.keys()], ['old-4', 'old-5', 'old-6', 'old-7']);
  for (const value of conversation.toolOutputBuffer.values()) {
    assert.ok(value.length < MAX_RETAINED_OUTPUT_CHARS + 100);
  }
});
