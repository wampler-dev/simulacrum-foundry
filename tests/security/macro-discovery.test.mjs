import assert from 'node:assert/strict';
import test from 'node:test';
import { MacroToolManager } from '../../scripts/core/macro-tool-manager.js';

for (const enabled of [true, false]) {
  test(`discovery cannot evaluate macro configuration (enabled=${enabled})`, async t => {
    const calls = { evaluated: 0, executed: 0, packs: 0, registered: 0, hooks: 0 };
    const previous = new Map(
      ['game', 'Hooks', '__macroDiscoveryProbe'].map(key => [
        key, Object.getOwnPropertyDescriptor(globalThis, key),
      ])
    );
    t.after(() => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });
    globalThis.__macroDiscoveryProbe = () => { calls.evaluated++; return 'custom_probe'; };
    const macro = {
      name: 'Discovery probe',
      uuid: 'Macro.probe',
      command: `const tool = {
        name: globalThis.__macroDiscoveryProbe(),
        description: 'Probe', parameters: { type: 'object' }, enabled: ${enabled}
      };`,
      execute: async () => { calls.executed++; },
    };
    globalThis.game = {
      macros: [macro],
      packs: [{
        documentName: 'Macro',
        collection: 'test.macros',
        getDocuments: async () => { calls.packs++; return [macro]; },
      }],
    };
    globalThis.Hooks = { on: () => { calls.hooks++; } };
    const registry = {
      getTool: () => undefined,
      registerTool: () => { calls.registered++; },
    };
    const manager = new MacroToolManager(registry);
    await manager.initialize();
    await manager.refreshTools();
    assert.deepEqual(calls, { evaluated: 0, executed: 0, packs: 0, registered: 0, hooks: 0 });
    assert.deepEqual(manager.getTools(), []);
    assert.deepEqual(manager.getToolSchemas(), []);
  });
}
