import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentAPI } from '../../scripts/core/document-api.js';
import { DocumentSearchTool } from '../../scripts/tools/document-search.js';

function setup(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const actor = (id, name, note) => ({
    uuid: `Actor.${id}`, testUserPermission: () => true,
    toObject: () => ({ _id: id, name, note }),
  });
  const world = [actor('same', 'Goblin', 'fire'), actor('w2', 'Goblin Veteran', 'ice')];
  const indexes = new Map([
    ['world.one', [{ _id: 'same', name: 'Goblin', note: 'ice' }, { _id: 'p2', name: 'Goblin Shaman', note: 'fire' }]],
    ['world.two', [{ _id: 'same', name: 'Goblin', note: 'fire' }, { _id: 'p3', name: 'Goblin Scout', note: 'ice' }]],
  ]);
  const requests = [];
  const packs = [...indexes].map(([collection, index]) => ({
    collection, documentName: 'Actor', testUserPermission: () => true,
    getIndex: async options => { requests.push({ collection, options }); return index; },
  }));
  packs.get = id => packs.find(pack => pack.collection === id);
  globalThis.game = {
    user: { isGM: true }, documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', { contents: world }]]), packs,
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
  });
  return { requests };
}

test('default name search bounds combined world and pack results and reports limit', async t => {
  const { requests } = setup(t);
  const results = await DocumentAPI.searchDocuments({ query: 'goblin', maxResults: 3 });
  assert.deepEqual(results.map(result => [result.pack || 'world', result._id]), [
    ['world', 'same'], ['world', 'w2'], ['world.one', 'same'],
  ]);
  assert.equal(requests.length, 1, 'stop before indexing later packs');
  assert.deepEqual(requests[0].options.fields, ['name']);
  const tool = new DocumentSearchTool();
  const message = await tool.execute({ query: 'goblin', maxResults: 3 });
  assert.match(message.display, /Showing up to 3/);
  assert.match(message.display, /narrow the search/);
  assert.equal((message.content.match(/read_document:/g) || []).length, 3);
});

test('explicit fields, pack selection, and type filter agree with index behavior', async t => {
  const { requests } = setup(t);
  assert.equal((await DocumentAPI.searchDocuments({ query: 'fire' })).length, 0, 'name default does not inspect content');
  const inPack = await DocumentAPI.searchDocuments({ query: 'fire', fields: ['note'], pack: 'world.one', maxResults: 1 });
  assert.deepEqual(inPack.map(result => result._id), ['p2']);
  assert.deepEqual(requests.at(-1).options.fields, ['note']);
  const requestsBefore = requests.length;
  assert.deepEqual(await DocumentAPI.searchDocuments({ query: 'goblin', pack: 'world.one', types: ['Item'] }), []);
  assert.equal(requests.length, requestsBefore, 'type mismatch skips the pack');
});

test('broad search remains bounded across both packs with source identities intact', async t => {
  setup(t);
  const results = await DocumentAPI.searchDocuments({ query: 'goblin', maxResults: 100 });
  assert.equal(results.length, 6);
  assert.deepEqual(results.filter(result => result._id === 'same').map(result => result.pack || 'world'), [
    'world', 'world.one', 'world.two',
  ]);
  const defaultLimit = await DocumentAPI.searchDocuments({ query: 'goblin' });
  assert.equal(defaultLimit.length, 6);
  assert.deepEqual(await DocumentAPI.searchDocuments({ query: 'goblin', fields: [] }), defaultLimit);
});

test('empty or unbounded query fails before searching, and exact empty result stays empty', async t => {
  const { requests } = setup(t);
  await assert.rejects(DocumentAPI.searchDocuments({ query: '  ' }), /non-empty/);
  await assert.rejects(DocumentAPI.searchDocuments({ query: 'goblin', maxResults: 101 }), /1 to 100/);
  assert.equal(requests.length, 0);
  const tool = new DocumentSearchTool();
  assert.equal((await tool.execute({ query: ' ' })).error.type, 'SEARCH_FAILED');
  assert.deepEqual(await DocumentAPI.searchDocuments({ query: 'unmatched' }), []);
});
