import assert from 'node:assert/strict';
import test from 'node:test';

// The tool executor imports a Foundry UI class for diagnostics.
globalThis.FormApplication = class {};
const { toolPermissionManager } = await import('../../scripts/core/tool-permission-manager.js');
const { toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { executeToolCalls } = await import('../../scripts/core/tool-execution.js');
const { interactionLogger } = await import('../../scripts/core/interaction-logger.js');

function setup(t, permission, confirmationAction) {
  const before = ['game', 'Hooks'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  globalThis.game = {
    settings: {
      get: (_scope, key) => key === 'toolPermissions'
        ? { document_copy: permission, document_move: permission }
        : false,
    },
    modules: new Map(),
    i18n: { localize: key => key },
  };
  const requests = [];
  const listeners = new Map();
  globalThis.Hooks = {
    on: (event, listener) => { listeners.set(event, listener); return event; },
    off: event => { listeners.delete(event); },
    callAll: (event, detail) => {
      requests.push(detail);
      if (confirmationAction) listeners.get('simulacrumToolConfirmationResponse')?.(
        detail.toolCallId, confirmationAction
      );
    },
  };
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  t.mock.method(interactionLogger, 'logToolResult', () => {});
  let mutations = 0;
  t.mock.method(toolRegistry, 'executeTool', async () => {
    mutations++;
    return { result: { content: 'done', display: 'done' } };
  });
  const history = [];
  const context = {
    conversationManager: {
      addMessage: (...args) => history.push(args),
      save: async () => {},
    },
    currentToolSupport: true,
  };
  return {
    requests, history, context,
    respond: (id, action) => listeners.get('simulacrumToolConfirmationResponse')?.(id, action),
    get mutations() { return mutations; },
  };
}

for (const name of ['document_copy', 'document_move']) {
  test(`${name}: deny setting prevents the mutation`, async t => {
    const state = setup(t, 'deny');
    const [outcome] = await executeToolCalls([{
      id: `deny-${name}`, function: { name, arguments: { justification: 'Test', sourceId: 'source' } },
    }], state.context);
    assert.equal(toolPermissionManager.isDestructive(name), true);
    const uiEntry = toolPermissionManager.getAllDestructiveTools().find(tool => tool.toolName === name);
    assert.equal(uiEntry?.permission, 'deny');
    assert.equal(uiEntry?.isStatic, true);
    assert.equal(outcome.success, false);
    assert.equal(outcome.result.denied, true);
    assert.equal(state.mutations, 0);
    assert.equal(state.requests.length, 0);
    assert.equal(JSON.parse(state.history[0][1]).denied, true);
  });

  test(`${name}: explicit allow setting permits execution without prompting`, async t => {
    const state = setup(t, 'allow');
    const [outcome] = await executeToolCalls([{
      id: `allowed-${name}`,
      function: { name, arguments: { justification: 'Test', sourceId: 'source' } },
    }], state.context);
    assert.equal(outcome.success, true);
    assert.equal(state.mutations, 1);
    assert.equal(state.requests.length, 0);
  });

  for (const action of ['deny', 'allow']) {
    test(`${name}: confirmation ${action} ${action === 'deny' ? 'blocks' : 'permits'} execution`, async t => {
      const state = setup(t, 'ask', action);
      const [outcome] = await executeToolCalls([{
        id: `${action}-${name}`,
        function: { name, arguments: { justification: 'Test', sourceId: 'source' } },
      }], state.context);
      assert.equal(state.requests.length, 1);
      assert.equal(state.requests[0].toolName, name);
      assert.match(state.requests[0].displayName, /document_copy|document_move/);
      assert.match(state.requests[0].explainerText, /document|copy|move/i);
      assert.equal(state.mutations, action === 'allow' ? 1 : 0);
      assert.equal(outcome.success, action === 'allow');
      if (action === 'deny') assert.equal(outcome.result.denied, true);
    });
  }
}

test('Stop immediately after approval prevents an unstarted mutation', async t => {
  const state = setup(t, 'ask', null);
  const controller = new AbortController();
  state.context.signal = controller.signal;
  const turn = executeToolCalls([{
    id: 'stopped-copy',
    function: { name: 'document_copy', arguments: { justification: 'Test', sourceId: 'source' } },
  }], state.context);
  assert.equal(state.requests.length, 1);
  state.respond('stopped-copy', 'allow');
  // Resolve approval, then abort before the executor resumes after its await.
  controller.abort();
  await turn;
  assert.equal(state.mutations, 0);
});
