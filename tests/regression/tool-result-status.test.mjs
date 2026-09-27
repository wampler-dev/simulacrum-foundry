import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { ToolRegistry, toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { executeToolCalls } = await import('../../scripts/core/tool-execution.js');
const { toolPermissionManager } = await import('../../scripts/core/tool-permission-manager.js');
const { interactionLogger } = await import('../../scripts/core/interaction-logger.js');
const { formatToolCallDisplay } = await import('../../scripts/utils/message-utils.js');

test('registry counts returned error, partial result, thrown error, and success consistently', async () => {
  const registry = new ToolRegistry();
  for (const [name, execute] of [
    ['returned', async () => ({ error: { message: 'refused' }, content: 'refused' })],
    ['partial', async () => ({ partial: { copyCompleted: true }, content: 'incomplete' })],
    ['flagged', async () => ({ success: false, content: 'refused' })],
    ['thrown', async () => { throw new Error('broken'); }],
    ['ok', async () => ({ content: 'done' })],
  ]) registry.registerTool({ name, description: name, execute });
  for (const name of ['returned', 'partial', 'flagged']) {
    assert.equal((await registry.executeTool(name)).success, false);
  }
  await assert.rejects(registry.executeTool('thrown'), /broken/);
  assert.equal((await registry.executeTool('ok')).success, true);
  assert.equal(registry.getStats().totalSuccesses, 1);
  assert.equal(registry.getStats().totalFailures, 4);
});

test('executor and UI retain failure and partial status in history, callback and loop outcome', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { i18n: { localize: key => key } };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
  });
  t.mock.method(toolPermissionManager, 'isDestructive', () => false);
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  t.mock.method(interactionLogger, 'logToolResult', () => {});
  const result = { error: { message: 'deletion failed' }, partial: { copyCompleted: true }, content: 'x'.repeat(5000) };
  t.mock.method(toolRegistry, 'executeTool', async () => ({ success: false, result }));
  const history = [];
  const callbacks = [];
  const [outcome] = await executeToolCalls([{
    id: 'call-1', function: { name: 'document_move', arguments: { justification: 'Test' } },
  }], {
    currentToolSupport: true,
    conversationManager: {
      toolOutputBuffer: new Map(), addMessage: (...args) => history.push(args), save: async () => {},
    },
    onToolResult: async data => callbacks.push(data),
  });
  assert.equal(outcome.success, false);
  const stored = JSON.parse(history[0][1]);
  assert.equal(stored._compacted, true);
  assert.equal(stored.success, false);
  assert.equal(stored.error.message, 'deletion failed');
  assert.equal(stored.partial.copyCompleted, true);
  assert.equal(callbacks.length, 1);
  assert.match(formatToolCallDisplay({ content: callbacks[0].content }, 'document_move'), /tool-failure/);
  assert.match(formatToolCallDisplay({ content: history[0][1] }, 'document_move'), /tool-failure/);
});
