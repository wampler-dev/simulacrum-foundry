import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { executeToolCalls } = await import('../../scripts/core/tool-execution.js');
const { toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { toolPermissionManager } = await import('../../scripts/core/tool-permission-manager.js');
const { interactionLogger } = await import('../../scripts/core/interaction-logger.js');

test('successful create and update use their own returned readback, without an extra read call', async t => {
  const calls = [];
  t.mock.method(toolPermissionManager, 'isDestructive', () => false);
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  t.mock.method(interactionLogger, 'logToolResult', () => {});
  t.mock.method(toolRegistry, 'executeTool', async (name, args) => {
    calls.push({ name, args });
    if (name === 'read_document') throw new Error('Unexpected generic verification read');
    return { result: {
      content: JSON.stringify({ message: 'Completed', document: { _id: 'created', name: 'Hero' } }),
      document: { _id: 'created', name: 'Hero' },
      display: 'Completed Hero',
    } };
  });
  const messages = [];
  const context = {
    currentToolSupport: true,
    conversationManager: {
      addMessage: (...args) => messages.push(args),
      save: async () => {},
    },
  };
  const notifications = [];
  context.onToolResult = async result => notifications.push(result);
  const toolCalls = ['create_document', 'update_document'].map((name, index) => ({
    id: `call-${index}`, function: { name, arguments: { documentType: 'Actor', documentId: 'created', justification: 'Test' } },
  }));
  const outcomes = await executeToolCalls(toolCalls, context);
  assert.deepEqual(calls.map(call => call.name), ['create_document', 'update_document']);
  assert.deepEqual(outcomes.map(outcome => outcome.success), [true, true]);
  assert.deepEqual(messages.map(message => message[3]), ['call-0', 'call-1']);
  assert.equal(notifications.length, 2);
  for (const message of messages) {
    assert.equal(JSON.parse(message[1]).document._id, 'created');
  }
});
