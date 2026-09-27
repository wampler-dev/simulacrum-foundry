import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { getTurnToolNames, getTurnToolSchemas } = await import('../../scripts/core/turn-capabilities.js');
const { executeToolCalls } = await import('../../scripts/core/tool-execution.js');
const { toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { interactionLogger } = await import('../../scripts/core/interaction-logger.js');
const { ConversationEngine } = await import('../../scripts/core/conversation-engine.js');
const { SimulacrumCore } = await import('../../scripts/core/simulacrum-core.js');

const turn = content => [{ role: 'user', content }];

test('a turn advertises the same bounded surface through the registry', () => {
  const registry = { getToolSchemas: () => ['read_document', 'delete_document', 'run_javascript', 'end_loop'].map(name => ({ function: { name } })) };
  const { allowed, schemas } = getTurnToolSchemas(turn('What is the weather like?'), registry);
  assert.deepEqual(schemas.map(schema => schema.function.name), ['read_document', 'end_loop']);
  assert.equal(allowed.has('delete_document'), false);
  assert.equal(allowed.has('run_javascript'), false);
});

test('explicit tasks grant only relevant capabilities; read-only instruction prevails', () => {
  assert.equal(getTurnToolNames(turn('Create an actor named Bob')).has('create_document'), true);
  assert.equal(getTurnToolNames(turn('Set actor hit points to 25')).has('update_document'), true);
  assert.equal(getTurnToolNames(turn('Change ownership of this journal')).has('set_document_ownership'), true);
  assert.equal(getTurnToolNames(turn('Execute a macro named Setup')).has('execute_macro'), true);
  assert.equal(getTurnToolNames(turn('Explain how to run JavaScript')).has('run_javascript'), false);
  assert.equal(getTurnToolNames(turn('Read only: explain how to delete an actor')).has('delete_document'), false);
  assert.equal(getTurnToolNames(turn('What does this JavaScript do?')).has('run_javascript'), false);
});

test('common read requests offer only the tools needed for their path', () => {
  assert.deepEqual([...getTurnToolNames(turn('Hello!'))], []);
  assert.deepEqual([...getTurnToolNames(turn('Thanks for your help.'))], []);
  const named = getTurnToolNames(turn('Find the Goblin Warrior from the Monster Manual'));
  assert.equal(named.has('search_documents'), true);
  assert.equal(named.has('read_document'), true);
  assert.equal(named.has('read_tool_output'), true, 'large results can require paging in the same turn');
  assert.equal(named.has('end_loop'), true, 'loop completion remains available');
  assert.equal(named.has('list_documents'), false);
  assert.equal(named.has('search_assets'), false);
  assert.equal(getTurnToolNames(turn('List all Actor documents')).has('list_documents'), true);
  assert.equal(getTurnToolNames(turn('List all spells')).has('list_documents'), true);
  assert.equal(getTurnToolNames(turn('Which compendium packs are available?')).has('list_documents'), true);
  assert.equal(getTurnToolNames(turn('What portrait and token does it already use?')).has('search_assets'), false);
  assert.equal(getTurnToolNames(turn('Find alternative artwork for this actor')).has('search_assets'), true);
  assert.equal(getTurnToolNames(turn('Find different artwork from what it already uses')).has('search_assets'), true);
  assert.equal(getTurnToolNames(turn('Read only: list all actors')).has('list_documents'), true);
});

test('dispatcher rejects an unadvertised native or inline call without executing it', async t => {
  let executions = 0;
  t.mock.method(toolRegistry, 'executeTool', async () => { executions++; return { result: { success: true } }; });
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  const allowedToolNames = getTurnToolNames(turn('Find the actor named Bob'));
  for (const currentToolSupport of [true, false]) {
    const messages = [];
    const callbacks = [];
    const [outcome] = await executeToolCalls([{ id: `call-${currentToolSupport}`, function: { name: 'run_javascript', arguments: '{}' } }], {
      allowedToolNames,
      currentToolSupport,
      conversationManager: { addMessage: (...args) => messages.push(args), save: async () => {} },
      onToolResult: async result => callbacks.push(result),
    });
    assert.equal(outcome.success, false);
    assert.equal(outcome.result.denied, true);
    assert.equal(callbacks.length, 1);
    assert.equal(messages.length, currentToolSupport ? 1 : 0);
  }
  assert.equal(executions, 0);
});

test('engine retries with the original capability set after history replacement', async t => {
  const previousGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { settings: { get: () => false } };
  t.after(() => {
    if (previousGame) Object.defineProperty(globalThis, 'game', previousGame);
    else delete globalThis.game;
  });
  t.mock.method(toolRegistry, 'getToolSchemas', () => ['read_document', 'create_document', 'run_javascript'].map(name => ({ function: { name } })));
  let history = turn('Read an actor');
  const offered = [];
  t.mock.method(SimulacrumCore, 'generateResponse', async (_messages, options) => {
    offered.push(options.tools.map(schema => schema.function.name));
    history = turn('Execute JavaScript'); // Models a manager replacing history during compaction.
    return offered.length === 1 ? { _parseError: true, content: '' } : { role: 'assistant', content: 'Done', toolCalls: [] };
  });
  await new ConversationEngine({ getMessages: () => history, addMessage: () => {} }).processTurn();
  assert.deepEqual(offered, [['read_document'], ['read_document']]);
});

test('engine accepts a direct answer without starting the tool loop', async t => {
  const manager = { getMessages: () => turn('Hello') };
  const emitted = [];
  t.mock.method(toolRegistry, 'getToolSchemas', () => []);
  t.mock.method(SimulacrumCore, 'generateResponse', async () => ({ role: 'assistant', content: 'Hello!', toolCalls: [] }));
  const result = await new ConversationEngine(manager).processTurn({ onAssistantMessage: message => emitted.push(message) });
  assert.equal(result.content, 'Hello!');
  assert.deepEqual(emitted.map(message => message.content), ['Hello!']);
});

test('an action request with no action call cannot report completion', async t => {
  const history = turn('Create an actor named Bob');
  const messages = [];
  const emitted = [];
  t.mock.method(toolRegistry, 'getToolSchemas', () => []);
  t.mock.method(SimulacrumCore, 'generateResponse', async () => ({ role: 'assistant', content: 'I created Bob.', toolCalls: [] }));
  const result = await new ConversationEngine({ getMessages: () => history, addMessage: (...args) => messages.push(args) })
    .processTurn({ onAssistantMessage: message => emitted.push(message) });
  assert.equal(result._terminalReason, 'action_not_executed');
  assert.equal(emitted.length, 1);
  assert.doesNotMatch(emitted[0].content, /created Bob/);
  assert.deepEqual(messages.map(args => args[1]), [result.content]);
});

test('exhausted initial tool-call failures do not trigger a prose fallback', async t => {
  const history = turn('Find an actor');
  const messages = [];
  const emitted = [];
  let calls = 0;
  t.mock.method(toolRegistry, 'getToolSchemas', () => []);
  t.mock.method(SimulacrumCore, 'generateResponse', async () => {
    calls++;
    return { errorCode: 'TOOL_CALL_FAILURE', content: 'I found the actor.', toolCalls: [] };
  });
  const result = await new ConversationEngine({ getMessages: () => history, addMessage: (...args) => messages.push(args) })
    .processTurn({ onAssistantMessage: message => emitted.push(message) });
  assert.equal(calls, 3);
  assert.equal(result._terminalReason, 'tool_call_failure');
  assert.doesNotMatch(result.content, /found the actor/);
  assert.equal(emitted.length, 1);
  assert.equal(messages.filter(args => args[0] === 'system').length, 0);
});
