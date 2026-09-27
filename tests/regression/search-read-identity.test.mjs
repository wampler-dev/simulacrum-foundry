import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentSearchTool } from '../../scripts/tools/document-search.js';
import { DocumentReadTool } from '../../scripts/tools/document-read.js';
import { DocumentAPI } from '../../scripts/core/document-api.js';
import { documentReadRegistry } from '../../scripts/utils/document-read-registry.js';

test('search hands world and pack result arguments directly to read', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = {
    documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', {}]]),
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
    documentReadRegistry.clear();
  });
  const results = [
    { type: 'Actor', _id: 'shared', name: 'Hero', uuid: 'Actor.shared' },
    { type: 'Actor', _id: 'shared', name: 'Hero', pack: 'world.heroes', uuid: 'Compendium.world.heroes.Actor.shared' },
  ];
  t.mock.method(DocumentAPI, 'searchDocuments', async () => results);
  const observed = [];
  t.mock.method(DocumentAPI, 'getDocument', async (...args) => {
    observed.push(args);
    return { _id: args[1], name: 'Hero' };
  });
  const content = (await new DocumentSearchTool().execute({ query: 'Hero' })).content;
  const handoffs = JSON.parse(content).candidates.map(candidate => candidate.read_document);
  assert.deepEqual(handoffs, [
    { documentType: 'Actor', documentId: 'shared' },
    { documentType: 'Actor', documentId: 'shared', pack: 'world.heroes' },
  ]);
  for (const args of handoffs) {
    assert.equal((await new DocumentReadTool().execute(args)).error, undefined);
  }
  assert.equal(observed[0][2].pack, undefined);
  assert.equal(observed[1][2].pack, 'world.heroes');
  assert.deepEqual(observed.map(call => call[2].includeEmbedded), [false, false]);
});

test('read accepts linked and bare top-level UUIDs, rejects mismatched and embedded targets', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { documentTypes: { Actor: ['npc'] }, collections: new Map([['Actor', {}]]) };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
    documentReadRegistry.clear();
  });
  const observed = [];
  t.mock.method(DocumentAPI, 'getDocument', async (...args) => {
    observed.push(args);
    return { _id: 'shared', name: 'Hero' };
  });
  const read = new DocumentReadTool();
  for (const documentId of ['Compendium.world.heroes.Actor.shared', '@UUID[Compendium.world.heroes.Actor.shared]{Hero}']) {
    assert.equal((await read.execute({ documentType: 'Actor', documentId })).error, undefined);
  }
  assert.equal(observed.length, 2);
  assert.equal(observed[0][1], 'shared');
  assert.equal(observed[0][2].pack, 'world.heroes');
  const bad = [
    { documentId: 'Compendium.world.heroes.Actor.shared', pack: 'world.other' },
    { documentId: 'Compendium.world.heroes.Actor.shared.Item.child' },
    { documentId: 'Actor.shared.Item.child' },
    { documentId: 'Actor.shared', pack: 'world.heroes' },
  ];
  for (const entry of bad) {
    assert.ok((await read.execute({ documentType: 'Actor', ...entry })).error);
  }
  assert.equal(observed.length, 2);
});

test('exact source title hands one selected identity to a field read', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const pack = {
    collection: 'dnd5e.monsters', metadata: { title: 'Monster Manual' }, documentName: 'Actor',
    testUserPermission: () => true,
    getIndex: async () => [{ _id: 'selected', name: 'Goblin Warrior' }],
  };
  const packs = [pack];
  packs.get = id => id === pack.collection ? pack : null;
  globalThis.game = { user: { isGM: true }, documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', { contents: [{ uuid: 'Actor.other',
      testUserPermission: () => true, toObject: () => ({ _id: 'other', name: 'Goblin Warrior', system: { hp: 99 } }) }] }]]), packs };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
    documentReadRegistry.clear();
  });
  const selected = await new DocumentSearchTool().execute({ query: 'Goblin Warrior', exact: true, source: 'Monster Manual' });
  assert.equal(JSON.parse(selected.content).status, 'unique');
  assert.doesNotMatch(selected.content, /system|hp/);
  const args = JSON.parse(selected.content).candidates[0].read_document;
  assert.deepEqual(args, { documentType: 'Actor', documentId: 'selected', pack: 'dnd5e.monsters' });
  t.mock.method(DocumentAPI, 'getDocument', async (_type, id, options) => {
    assert.equal(id, 'selected');
    assert.equal(options.pack, 'dnd5e.monsters');
    return { _id: id, name: 'Goblin Warrior', system: { hp: 7 } };
  });
  const read = await new DocumentReadTool().execute({ ...args, fields: ['system.hp'] });
  assert.equal(read.error, undefined);
  assert.match(read.content, /"system.hp": 7/);
  assert.doesNotMatch(read.content, /99/);
});
