import assert from 'node:assert/strict';
import test from 'node:test';
// Foundry provides this UI base class; these tests do not render the log UI.
const previousFormApplication = Object.getOwnPropertyDescriptor(globalThis, 'FormApplication');
globalThis.FormApplication = class {};
const { MacroToolManager } = await import('../../scripts/core/macro-tool-manager.js');
const { ToolRegistry, toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { ExecuteMacroTool } = await import('../../scripts/tools/execute-macro.js');
const { toolPermissionManager } = await import('../../scripts/core/tool-permission-manager.js');
const { executeToolCalls } = await import('../../scripts/core/tool-execution.js');
const { interactionLogger } = await import('../../scripts/core/interaction-logger.js');
if (previousFormApplication) {
  Object.defineProperty(globalThis, 'FormApplication', previousFormApplication);
} else {
  delete globalThis.FormApplication;
}

function installGlobals(t, values) {
  const previous = new Map(Object.keys(values).map(key => [
    key, Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  Object.assign(globalThis, values);
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

for (const name of ['read_document', 'execute_macro', 'unprefixed_custom_tool']) {
  test(`macro configuration cannot register or replace ${name}`, async t => {
    let executions = 0;
    const macro = {
      name: 'Untrusted configuration',
      command: `const tool = ${JSON.stringify({
        name, description: 'Probe', parameters: { type: 'object' }, enabled: true,
      })};`,
      execute: async () => { executions++; },
    };
    installGlobals(t, {
      game: {
        macros: [macro],
        packs: [{ documentName: 'Macro', getDocuments: async () => [macro] }],
      },
      Hooks: { on: () => {} },
    });
    const registry = new ToolRegistry();
    registry.registerDefaults();
    const before = registry.getToolSchemas();
    const readTool = registry.getTool('read_document');
    const macroTool = registry.getTool('execute_macro');
    assert.ok(readTool);
    assert.ok(macroTool instanceof ExecuteMacroTool);
    const manager = new MacroToolManager(registry);
    await manager.initialize();
    await manager.refreshTools();
    assert.equal(registry.getTool('read_document'), readTool);
    assert.equal(registry.getTool('execute_macro'), macroTool);
    assert.equal(registry.getTool('unprefixed_custom_tool'), null);
    assert.deepEqual(registry.getToolSchemas(), before);
    assert.deepEqual(manager.getTools(), []);
    assert.equal(executions, 0);
    assert.throws(() => registry.registerTool({
      name: 'read_document', description: 'Collision', execute: macro.execute,
    }), /already exists/);
    assert.equal(registry.getTool('read_document'), readTool);
  });
}

test('explicit macro execution honors denial regardless of target macro name', async t => {
  let executions = 0;
  let lookups = 0;
  installGlobals(t, {
    game: {
      user: { isGM: true },
      settings: { get: (_scope, key) => key === 'toolPermissions'
        ? { execute_macro: 'deny' } : false },
      macros: { getName: () => { lookups++; return { execute: () => { executions++; } }; } },
      i18n: { localize: key => key },
    },
  });
  // Diagnostics persistence is outside this contract; execution and policy stay real.
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  toolRegistry.registerTool(new ExecuteMacroTool());
  t.after(() => toolRegistry.unregisterTool('execute_macro'));
  assert.equal(toolPermissionManager.isDestructive('execute_macro'), true);
  const history = [];
  const conversationManager = {
    addMessage: (...args) => history.push(args),
    save: async () => {},
  };
  for (const name of ['read_document', 'unprefixed_custom_tool']) {
    const [outcome] = await executeToolCalls([{
      id: `denied-${name}`,
      function: {
        name: 'execute_macro',
        arguments: JSON.stringify({ name, justification: 'Permission regression test' }),
      },
    }], { conversationManager, currentToolSupport: true });
    assert.equal(outcome.success, false);
    assert.equal(outcome.result.denied, true);
  }
  assert.equal(executions, 0);
  assert.equal(lookups, 0);
  assert.equal(history.length, 2);
  for (const message of history) {
    assert.equal(message[0], 'tool');
    assert.equal(JSON.parse(message[1]).denied, true);
  }
});
