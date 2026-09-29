import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { ChatHandler } = await import('../../../scripts/core/chat-handler.js');
const { SimulacrumCore } = await import('../../../scripts/core/simulacrum-core.js');
const { toolRegistry } = await import('../../../scripts/core/tool-registry.js');
const { ConversationManager } = await import('../../../scripts/core/conversation.js');
const { ConversationEngine } = await import('../../../scripts/core/conversation-engine.js');
const { executeToolCalls } = await import('../../../scripts/core/tool-execution.js');

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

test('Stop, immediate new turn, and late tool completion retain ownership and parity after reload', async t => {
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const oldHooks = Object.getOwnPropertyDescriptor(globalThis, 'Hooks');
  let saved;
  globalThis.game = {
    settings: { get: () => false },
    i18n: { localize: key => key },
    user: {
      id: 'gm',
      setFlag: async (_scope, _key, state) => { saved = structuredClone(state); },
      getFlag: async () => structuredClone(saved),
    },
  };
  t.after(() => oldGame ? Object.defineProperty(globalThis, 'game', oldGame) : delete globalThis.game);
  globalThis.Hooks = { callAll: () => {} };
  t.after(() => oldHooks ? Object.defineProperty(globalThis, 'Hooks', oldHooks) : delete globalThis.Hooks);

  const manager = new ConversationManager('gm', 'overlapping-turns');
  const call = { id: 'old-tool-call', function: { name: 'search_documents', arguments: '{"query":"Skeleton"}' } };
  const nextCall = { id: 'unstarted-call', function: { name: 'read_document', arguments: '{}' } };
  let executions = 0;
  let releaseTool;
  let startedTool;
  const started = new Promise(resolve => { startedTool = resolve; });
  const completed = new Promise(resolve => { releaseTool = resolve; });
  t.mock.method(toolRegistry, 'executeTool', async () => {
    executions++;
    startedTool();
    await completed;
    return { success: true, result: { content: 'Old search completed' } };
  });
  const observed = [];
  t.mock.method(ConversationEngine.prototype, 'processTurn', async ({ signal, onToolResult }) => {
    if (signal) {
      manager.addMessage('assistant', null, [call, nextCall]);
      await executeToolCalls([call, nextCall], {
        conversationManager: manager, signal, currentToolSupport: true,
        onToolResult: result => onToolResult(result),
      });
      if (signal.aborted) throw Object.assign(new Error('Process was cancelled'), { name: 'AbortError' });
    } else {
      observed.push(structuredClone(manager.getMessages()));
      manager.addMessage('assistant', 'New answer');
    }
    return { role: 'assistant', content: 'New answer' };
  });

  const handler = new ChatHandler(manager);
  const controller = new AbortController();
  const oldTurn = handler.processUserMessage('Old search', { id: 'gm' }, {
    signal: controller.signal,
    onAssistantMessage: () => {},
    onToolResult: result => observed.push(result),
  });
  await started;
  controller.abort();
  await manager.save();
  await handler.processUserMessage('New question', { id: 'gm' });

  const before = manager.getMessages();
  assert.deepEqual(before.map(message => message.role),
    ['user', 'assistant', 'tool', 'tool', 'assistant', 'user', 'assistant']);
  assert.equal(JSON.parse(before[2].content).pending, true);
  assert.equal(JSON.parse(before[3].content).cancelled, true);
  assert.equal(before[4].content, 'Process cancelled by user');
  assert.equal(observed[0][5].content, 'New question');

  releaseTool();
  await oldTurn;
  const history = manager.getMessages();
  assert.deepEqual(history.map(message => message.role),
    ['user', 'assistant', 'tool', 'tool', 'assistant', 'user', 'assistant']);
  assert.equal(history[1].tool_calls[0].id, history[2].tool_call_id);
  assert.equal(history[1].tool_calls[1].id, history[3].tool_call_id);
  assert.equal(JSON.parse(history[2].content).content, 'Old search completed');
  assert.equal(JSON.parse(history[3].content).cancelled, true);
  assert.equal(history[4].content, 'Process cancelled by user');
  assert.equal(executions, 1);
  assert.equal(observed[1].cancelled, true);

  const restored = new ConversationManager('gm', 'overlapping-turns');
  assert.equal(await restored.load(), true);
  assert.deepEqual(restored.getMessages(), history);
});
