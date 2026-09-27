import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { ChatHandler } = await import('../../../scripts/core/chat-handler.js');
const { SimulacrumCore } = await import('../../../scripts/core/simulacrum-core.js');
const { toolRegistry } = await import('../../../scripts/core/tool-registry.js');

test('supported chat entry point delegates one turn and records the direct answer once', async t => {
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { settings: { get: () => false } };
  t.after(() => oldGame ? Object.defineProperty(globalThis, 'game', oldGame) : delete globalThis.game);
  const messages = [];
  const manager = {
    getMessages: () => messages,
    addMessage: (role, content) => messages.push({ role, content }),
  };
  let calls = 0;
  t.mock.method(toolRegistry, 'getToolSchemas', () => []);
  t.mock.method(SimulacrumCore, 'generateResponse', async () => {
    calls++;
    return { role: 'assistant', content: 'Hello!', toolCalls: [] };
  });
  const shown = [];
  const result = await new ChatHandler(manager).processUserMessage('Hello', { id: 'gm' }, {
    onAssistantMessage: message => shown.push(message),
  });
  assert.equal(result.content, 'Hello!');
  assert.equal(calls, 1);
  assert.deepEqual(messages.map(message => [message.role, message.content]), [['user', 'Hello'], ['assistant', 'Hello!']]);
  assert.deepEqual(shown.map(message => message.content), ['Hello!']);
});
