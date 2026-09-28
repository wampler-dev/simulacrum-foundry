import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { ChatHandler } = await import('../../../scripts/core/chat-handler.js');
const { SimulacrumCore } = await import('../../../scripts/core/simulacrum-core.js');
const { toolRegistry } = await import('../../../scripts/core/tool-registry.js');
const { ConversationManager } = await import('../../../scripts/core/conversation.js');

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

test('Stop closes the interrupted turn in history before the next request', async t => {
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  let storedState;
  globalThis.game = {
    settings: { get: () => false },
    user: {
      id: 'gm',
      setFlag: async (_scope, _key, state) => { storedState = structuredClone(state); },
      getFlag: async () => structuredClone(storedState),
    },
  };
  t.after(() => oldGame ? Object.defineProperty(globalThis, 'game', oldGame) : delete globalThis.game);

  const manager = new ConversationManager('gm', 'test-world');
  t.mock.method(toolRegistry, 'getToolSchemas', () => []);
  let requests = 0;
  let secondRequestHistory;
  t.mock.method(SimulacrumCore, 'generateResponse', async history => {
    requests++;
    if (requests === 1) {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }
    secondRequestHistory = history.map(message => ({ ...message }));
    return { role: 'assistant', content: 'Monster Manual only', toolCalls: [] };
  });

  const handler = new ChatHandler(manager);
  await handler.processUserMessage('Compare both books', { id: 'gm' });
  const cancelledState = structuredClone(storedState.activeMessages);
  const restored = new ConversationManager('gm', 'test-world');
  assert.equal(await restored.load(), true);
  await new ChatHandler(restored).processUserMessage('Read Monster Manual only', { id: 'gm' });

  assert.deepEqual(secondRequestHistory, [
    { role: 'user', content: 'Compare both books' },
    { role: 'assistant', content: 'Process cancelled by user' },
    { role: 'user', content: 'Read Monster Manual only' },
  ]);
  assert.deepEqual(cancelledState, secondRequestHistory.slice(0, 2));
  assert.equal(requests, 2);
  assert.equal(restored.getMessages().at(-1).content, 'Monster Manual only');
});
