import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentAPI } from '../../scripts/core/document-api.js';
import { DocumentSearchTool } from '../../scripts/tools/document-search.js';
import { DocumentReadTool } from '../../scripts/tools/document-read.js';
import { documentReadRegistry } from '../../scripts/utils/document-read-registry.js';

test('broad Goblin Warrior search distinguishes three exact identities from Hobgoblin matches', async t => {
  const previous = globalThis.game;
  t.after(() => { globalThis.game = previous; });
  const sources = ['dnd5e.actors24', 'dnd-heroes-borderlands.actors', 'dnd-monster-manual.actors'];
  globalThis.game = { packs: new Map(), modules: new Map([['dnd-monster-manual', { title: 'Dungeons & Dragons Monster Manual' }]]) };
  const hits = sources.flatMap(pack => ['Goblin Warrior', 'Hobgoblin Warrior'].map(name => ({
    type: 'Actor', _id: name === 'Goblin Warrior' ? 'same-id' : 'other-id', name, pack,
  })));
  t.mock.method(DocumentAPI, 'searchDocuments', async () => hits);
  const result = await new DocumentSearchTool().execute({ query: 'Goblin Warrior', documentTypes: ['Actor'] });
  const body = JSON.parse(result.content);
  assert.equal(body.status, 'ambiguous');
  assert.deepEqual(body.candidates.map(c => c.source), sources);
  assert.equal(body.candidates.length, 3, 'same document ID across packs does not collapse identities');
  assert.ok(body.candidates.every(c => c.name === 'Goblin Warrior' && !Object.hasOwn(c, 'read_document')));
  assert.equal(body.candidates[2].packageTitle, 'Dungeons & Dragons Monster Manual');
  assert.match(body.guidance, /Ask the user/);
  assert.doesNotMatch(result.content, /Hobgoblin/);
  assert.ok(JSON.stringify(result).length < 3500, 'clarification fits dispatcher compaction budget');
});

test('one exact candidate among substring matches stays a broad result, not a claimed unique identity', async t => {
  globalThis.game = { packs: new Map() };
  t.after(() => { delete globalThis.game; });
  t.mock.method(DocumentAPI, 'searchDocuments', async () => [
    { type: 'Actor', _id: 'one', name: 'Goblin Warrior' },
    { type: 'Actor', _id: 'two', name: 'Hobgoblin Warrior' },
  ]);
  const result = JSON.parse((await new DocumentSearchTool().execute({ query: 'Goblin Warrior', maxResults: 2 })).content);
  assert.equal(result.status, 'results');
  assert.equal(result.limitReached, true);
  assert.equal(result.candidates.length, 2);
});

test('missing HP suffix yields actual prepared path for explicit retry without reading unrelated getters', async t => {
  const previous = globalThis.game;
  globalThis.game = { documentTypes: { Actor: ['npc'] }, collections: new Map([['Actor', {}]]) };
  t.after(() => { globalThis.game = previous; documentReadRegistry.clear(); });
  const system = { currency: {}, attributes: { hp: { value: 10 }, ac: { value: 15 } } };
  Object.defineProperty(system, 'unrelated', { enumerable: true, get() { throw new Error('Must not invoke getters while suggesting paths'); } });
  system.circular = system;
  t.mock.method(DocumentAPI, 'getDocument', async (_type, _id, options) => {
    options.onPreparedSystem?.(system);
    return { _id: 'actor', name: 'Goblin Warrior', system: {} };
  });
  const read = new DocumentReadTool();
  const parse = result => JSON.parse(result.content.split('\n\n').slice(1).join('\n\n'));
  const first = parse(await read.execute({ documentType: 'Actor', documentId: 'actor', fields: ['system.hp.value'] }));
  assert.deepEqual(first.missingFields, ['system.hp.value']);
  assert.deepEqual(first.fieldHints[0].suggestedFields, ['system.attributes.hp.value']);
  assert.deepEqual(first.fields, {}, 'suggesting a path must not pretend its value was already read');
  const retry = parse(await read.execute({ documentType: 'Actor', documentId: 'actor', fields: first.fieldHints[0].suggestedFields }));
  assert.equal(retry.fields['system.attributes.hp.value'], 10);
  assert.equal(retry.fieldSources['system.attributes.hp.value'], 'prepared');
});

test('path suggestions keep multiple alternatives and enforce depth, breadth, and result caps', () => {
  const read = new DocumentReadTool();
  const data = { system: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`group${i}`, { hp: { value: i } }])) };
  const hint = read._missingFieldHint(data, 'system.hp.value');
  assert.equal(hint.suggestedFields.length, 5);
  assert.equal(hint.suggestionSearchLimited, true);
  assert.deepEqual(read._missingFieldHint({ system: { nested: { deeper: { tooDeep: { hp: { value: 8 } } } } } }, 'system.hp.value').suggestedFields, []);
});
