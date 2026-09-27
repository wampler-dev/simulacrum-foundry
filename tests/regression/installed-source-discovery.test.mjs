import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentListTool } from '../../scripts/tools/document-list.js';
import { DocumentSearchTool } from '../../scripts/tools/document-search.js';
import { DocumentReadTool } from '../../scripts/tools/document-read.js';
import { documentReadRegistry } from '../../scripts/utils/document-read-registry.js';
import { getTurnToolSchemas } from '../../scripts/core/turn-capabilities.js';

test('discover same-title installed packs, select exact source, and read without substituting SRD Goblin', async t => {
  const previous = globalThis.game;
  t.after(() => { globalThis.game = previous; documentReadRegistry.clear(); });
  const seen = [];
  function pack(id, title, name, readable = true) {
    return {
      collection: id, metadata: { title, packageName: id.split('.')[0] }, documentName: 'Actor', index: { size: 1 },
      testUserPermission: (_user, level) => readable && level === 'OBSERVER',
      getIndex: async () => { seen.push(id); return [{ _id: 'same', name }]; },
      getDocument: async () => ({ constructor: { metadata: { embedded: {} } },
        uuid: `Compendium.${id}.Actor.same`,
        toObject: () => ({ _id: 'same', name, system: { attributes: { hp: { value: 10 } } } }) }),
    };
  }
  const packs = [
    pack('dnd5e.monsters', 'Monsters (SRD)', 'Goblin'),
    pack('dnd-monster-manual.actors', 'Actors', 'Goblin Warrior'),
    pack('dnd-heroes-borderlands.actors', 'Actors', 'Goblin Warrior'),
    pack('hidden.actors', 'Hidden', 'Goblin Warrior', false),
  ];
  packs.get = id => packs.find(p => p.collection === id);
  globalThis.game = {
    user: { isGM: false }, packs, system: { id: 'dnd5e', title: 'D&D Fifth Edition' },
    modules: new Map([
      ['dnd-monster-manual', { title: 'Dungeons & Dragons Monster Manual' }],
      ['dnd-heroes-borderlands', { title: 'Heroes of the Borderlands' }],
    ]),
    documentTypes: { Actor: ['npc'] }, collections: new Map([['Actor', { contents: [] }]]),
  };
  const list = new DocumentListTool();
  const search = new DocumentSearchTool();
  const read = new DocumentReadTool();
  const registry = { getToolSchemas: () => ['list_documents', 'search_documents', 'read_document', 'run_javascript', 'inspect_document_schema']
    .map(name => ({ function: { name } })) };
  const { schemas } = getTurnToolSchemas([{ role: 'user', content: 'Find the Goblin Warrior from the D&D Monster Manual. Do not modify anything.' }], registry);
  assert.deepEqual(schemas.map(s => s.function.name), ['list_documents', 'search_documents', 'read_document']);
  const catalog = await list.execute({ documentType: 'Compendium' });
  assert.match(catalog.content, /dnd-monster-manual.*Dungeons & Dragons Monster Manual/);
  assert.match(catalog.content, /dnd5e.*D&D Fifth Edition/);
  const scoped = await list.execute({ documentType: 'Compendium', packageId: 'dnd-monster-manual' });
  assert.deepEqual(JSON.parse(scoped.content).entries, [{ pack: 'dnd-monster-manual.actors', title: 'Actors', documentType: 'Actor' }]);
  assert.doesNotMatch(catalog.content, /hidden\.actors/);
  assert.deepEqual(seen, [], 'discovery reads metadata only');
  const wrong = await search.execute({ query: 'Goblin Warrior', exact: true, pack: 'dnd5e.monsters' });
  assert.equal(JSON.parse(wrong.content).status, 'no_match');
  assert.equal(JSON.parse(wrong.content).requestedSource, 'dnd5e.monsters');
  assert.match(wrong.display, /dnd5e\.monsters/);
  const selected = JSON.parse((await search.execute({ query: 'Goblin Warrior', exact: true, pack: 'dnd-monster-manual.actors' })).content);
  assert.equal(selected.status, 'unique');
  const args = selected.candidates[0].read_document;
  assert.equal(args.pack, 'dnd-monster-manual.actors');
  const facts = await read.execute({ ...args, fields: ['name', 'system.attributes.hp.value'] });
  assert.equal(facts.error, undefined);
  assert.match(facts.content, /Goblin Warrior/);
  assert.doesNotMatch(facts.content, /dnd5e.monsters/);
});

test('missing field guidance uses bounded actual keys and does not fabricate a derived value', () => {
  const read = new DocumentReadTool();
  const data = { name: 'Fixture', system: { attributes: { ac: { flat: 13, calc: 'flat' }, hp: { value: 10 } } } };
  const result = JSON.parse(read._formatDocumentContent(data, 'fixture', {
    documentType: 'Actor', fields: ['system.armor.class.value', 'system.attributes.ac.value', 'system.attributes.hp.value'],
  }));
  assert.deepEqual(result.fields, { 'system.attributes.hp.value': 10 });
  assert.deepEqual(result.fieldHints[0].availableFields, ['system.attributes']);
  assert.deepEqual(result.fieldHints[1].availableFields, ['system.attributes.ac.flat', 'system.attributes.ac.calc']);
  assert.match(result.guidance, /Prepared\/derived/);
  const large = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, 'x'.repeat(1000)]));
  const bounded = JSON.parse(read._formatDocumentContent(large, 'fixture', {
    documentType: 'Actor', fields: Array.from({ length: 10 }, (_, i) => `missing${i}`),
  }));
  assert.equal(bounded.missingFields.length, 10);
  assert.equal(bounded.fieldHints.length, 5);
  assert.equal(bounded.fieldHints[0].availableFields.length, 20);
  assert.equal(bounded.fieldHints[0].truncated, true);
  assert.doesNotMatch(JSON.stringify(bounded), /xxxxx/);
});
