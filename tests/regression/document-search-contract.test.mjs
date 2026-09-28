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
    collection, metadata: { title: collection === 'world.one' ? 'Monster Manual' : 'Other Monsters' },
    documentName: 'Actor', testUserPermission: (_user, level) => level === 'OBSERVER',
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
  assert.match(message.display, /Ambiguous exact name/);
  assert.match(message.display, /choose a source/);
  const output = JSON.parse(message.content);
  assert.equal(output.status, 'ambiguous');
  assert.equal(output.limitReached, true);
  assert.equal(output.candidates.length, 2);
  assert.deepEqual(output.candidates.map(candidate => candidate.source), ['world', 'world.one']);
  assert.equal(output.candidates[1].read_document, undefined);
  assert.equal(output.candidates[1].documentId, 'same');
  assert.equal(Object.hasOwn(output.candidates[1], 'uuid'), false, 'do not invent a UUID absent from the index');
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

test('exact names resolve a readable source without treating the index as document facts', async t => {
  const { requests } = setup(t);
  const tool = new DocumentSearchTool();
  const ambiguous = await tool.execute({ query: 'Goblin', exact: true });
  assert.equal(JSON.parse(ambiguous.content).status, 'ambiguous');
  assert.equal(JSON.parse(ambiguous.content).candidates.length, 3);
  assert.deepEqual(JSON.parse(ambiguous.content).candidates.map(candidate => candidate.source), ['world', 'world.one', 'world.two']);
  assert.equal(JSON.parse(ambiguous.content).limitReached, false);
  assert.doesNotMatch(ambiguous.content, /Goblin Veteran|Goblin Shaman/);
  assert.equal(requests.length, 2, 'include later packs so source choices are complete below the cap');

  const selected = await tool.execute({ query: 'gObLiN', exact: true, source: 'monster manual' });
  assert.equal(JSON.parse(selected.content).status, 'unique');
  assert.match(selected.content, /identity only.*read_document/);
  assert.equal(JSON.parse(selected.content).candidates[0].sourceTitle, 'Monster Manual');
  assert.equal(JSON.parse(selected.content).candidates[0].read_document.pack, 'world.one');
  assert.doesNotMatch(selected.content, /note|fire|ice/);
  assert.equal(JSON.parse(selected.content).candidates.length, 1);
  assert.equal(JSON.parse((await tool.execute({ query: 'Goblin', exact: true, source: 'world.one' })).content).status, 'unique');

  const world = await tool.execute({ query: 'Goblin', exact: true, source: 'world' });
  assert.equal(JSON.parse(world.content).status, 'unique');
  assert.equal(JSON.parse(world.content).candidates[0].source, 'world');
  assert.equal(Object.hasOwn(JSON.parse(world.content).candidates[0].read_document, 'pack'), false);
  const missing = await tool.execute({ query: 'Goblin', exact: true, source: 'Unknown Manual' });
  assert.equal(missing.error.type, 'SEARCH_FAILED');
  const notFound = await tool.execute({ query: 'Missing', exact: true, source: 'world.one' });
  assert.equal(JSON.parse(notFound.content).status, 'no_match');
  assert.equal(JSON.parse(notFound.content).candidates.length, 0);
  assert.equal(JSON.parse((await tool.execute({ query: 'Gob', exact: true })).content).status, 'no_match');
});

test('same-title and hidden sources cannot be silently selected', async t => {
  setup(t);
  const tool = new DocumentSearchTool();
  game.packs[1].metadata.title = 'Monster Manual';
  assert.match((await tool.execute({ query: 'Goblin', exact: true, source: 'Monster Manual' })).error.message, /ambiguous/);
  game.packs[1].testUserPermission = () => false;
  assert.match((await tool.execute({ query: 'Goblin', exact: true, source: 'world.two' })).error.message, /No readable pack/);
  assert.equal(JSON.parse((await tool.execute({ query: 'Goblin', exact: true, source: 'Monster Manual' })).content).status, 'unique');
  assert.match((await tool.execute({ query: 'Goblin', exact: true, source: 'world', pack: 'world.one' })).error.message, /either source or pack/);
  assert.match((await tool.execute({ query: 'Goblin', exact: true, fields: ['note'] })).error.message, /limited to the document name/);
});

test('malformed search hits cannot advertise fabricated read arguments', async t => {
  setup(t);
  t.mock.method(DocumentAPI, 'searchDocuments', async () => [{ type: 'Actor', name: 'Nameless ID' }]);
  const outcome = await new DocumentSearchTool().execute({ query: 'Nameless ID' });
  assert.equal(outcome.error.type, 'SEARCH_FAILED');
  assert.match(outcome.error.message, /usable document type or ID/);
  assert.doesNotMatch(outcome.content, /read_document/);
});
