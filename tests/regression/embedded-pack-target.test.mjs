import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentAPI } from '../../scripts/core/document-api.js';
import { DocumentUpdateTool } from '../../scripts/tools/document-update.js';
import { documentReadRegistry } from '../../scripts/utils/document-read-registry.js';

function actor() {
  const calls = [];
  return {
    calls,
    testUserPermission: () => true,
    createEmbeddedDocuments: async (name, data) => calls.push({ name, data }),
  };
}

test('embedded insert selects the pack document even when a world document shares its ID', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const world = actor();
  const packed = actor();
  globalThis.game = {
    user: { isGM: true },
    collections: new Map([['Actor', { get: () => world }]]),
    packs: new Map([['world.heroes', {
      documentName: 'Actor', locked: false, getDocument: async () => packed,
    }]]),
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
  });
  const operation = { embeddedName: 'Item', action: 'insert', data: { name: 'Shield' } };
  await DocumentAPI.applyEmbeddedOperations('Actor', 'shared', [operation], { pack: 'world.heroes' });
  assert.deepEqual(packed.calls, [{ name: 'Item', data: [{ name: 'Shield' }] }]);
  assert.deepEqual(world.calls, []);
  await DocumentAPI.applyEmbeddedOperations('Actor', 'shared', [operation]);
  assert.equal(world.calls.length, 1);
});

test('invalid pack and mismatched type reject before touching same-ID world document', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const world = actor();
  globalThis.game = {
    user: { isGM: true },
    collections: new Map([['Actor', { get: () => world }]]),
    packs: new Map([['world.items', { documentName: 'Item', getDocument: async () => actor() }]]),
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
  });
  const ops = [{ embeddedName: 'Item', action: 'insert', data: { name: 'Shield' } }];
  await assert.rejects(DocumentAPI.applyEmbeddedOperations('Actor', 'shared', ops, { pack: 'missing' }), /Unknown compendium pack/);
  await assert.rejects(DocumentAPI.applyEmbeddedOperations('Actor', 'shared', ops, { pack: 'world.items' }), /contains 'Item'/);
  assert.deepEqual(world.calls, []);
});

test('update tool passes its selected pack to embedded execution', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const previousConfig = Object.getOwnPropertyDescriptor(globalThis, 'CONFIG');
  const previousFoundry = Object.getOwnPropertyDescriptor(globalThis, 'foundry');
  globalThis.CONFIG = { Actor: {} };
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  const packed = { _id: 'shared', name: 'Hero', items: [] };
  const instance = { items: { documentClass: class Item {}, contents: [] } };
  globalThis.game = {
    user: { isGM: true },
    documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', { get: () => ({}) }]]),
    packs: new Map([['world.heroes', {
      documentName: 'Actor', locked: false, getDocument: async () => instance,
    }]]),
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
    if (previousConfig) Object.defineProperty(globalThis, 'CONFIG', previousConfig);
    else delete globalThis.CONFIG;
    if (previousFoundry) Object.defineProperty(globalThis, 'foundry', previousFoundry);
    else delete globalThis.foundry;
    documentReadRegistry.clear();
  });
  t.mock.method(DocumentAPI, 'getDocument', async () => packed);
  const observed = [];
  t.mock.method(DocumentAPI, 'applyEmbeddedOperations', async (...args) => observed.push(args));
  documentReadRegistry.registerRead('Actor', 'shared', packed);
  const result = await new DocumentUpdateTool().execute({
    documentType: 'Actor', documentId: 'shared', pack: 'world.heroes',
    operations: [{ action: 'insert', path: 'items', value: { name: 'Shield' } }],
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(observed.length, 1);
  assert.equal(observed[0][3].pack, 'world.heroes');
});
