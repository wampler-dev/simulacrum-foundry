import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentAPI } from '../../scripts/core/document-api.js';
import { DocumentReadTool } from '../../scripts/tools/document-read.js';
import { documentReadRegistry } from '../../scripts/utils/document-read-registry.js';

function setup(t) {
  const previous = globalThis.game;
  const stored = { _id: 'warrior', name: 'Goblin Warrior',
    system: { attributes: { ac: { flat: 15, calcs: ['unarmored', 'armored'], override: null }, hp: { value: 10 } } },
    items: [{ _id: 'armor', description: 'x'.repeat(20000) }] };
  const prepared = { attributes: { ac: { value: 15, flat: 15 }, hp: { value: 10, effectiveMax: 10 } } };
  Object.defineProperty(prepared, 'unrelated', { enumerable: true, get() { throw new Error('Do not serialize all prepared data'); } });
  const make = pack => ({ name: stored.name, uuid: pack ? `Compendium.${pack}.Actor.warrior` : 'Actor.warrior',
    system: prepared, constructor: { metadata: { embedded: { Item: 'items' } } },
    testUserPermission: () => true, toObject: () => structuredClone(stored),
    update: () => { throw new Error('Read must not mutate'); },
    prepareData: () => { throw new Error('Reuse existing prepared data'); } });
  const world = make();
  globalThis.game = { user: { isGM: true }, documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', { get: () => world }]]),
    packs: new Map([['dnd-monster-manual.actors', { documentName: 'Actor', getDocument: async () => make('dnd-monster-manual.actors') }]]) };
  t.after(() => { globalThis.game = previous; documentReadRegistry.clear(); });
  return { stored, prepared, world };
}
const payload = result => {
  assert.equal(result.error, undefined, result.error?.message);
  return JSON.parse(result.content.slice(result.content.indexOf('\n\n') + 2));
};

test('targeted world and pack reads return prepared AC/HP without dumping equipment or unrelated system data', async t => {
  const { prepared } = setup(t);
  const tool = new DocumentReadTool();
  for (const pack of [undefined, 'dnd-monster-manual.actors']) {
    const result = await tool.execute({ documentType: 'Actor', documentId: 'warrior', ...(pack ? { pack } : {}),
      fields: ['name', 'system.attributes.ac.value', 'system.attributes.hp.value', 'system.attributes.ac.override'] });
    const value = payload(result);
    assert.deepEqual(value.fields, { name: 'Goblin Warrior', 'system.attributes.ac.value': 15,
      'system.attributes.hp.value': 10, 'system.attributes.ac.override': null });
    assert.deepEqual(value.fieldSources, { name: 'stored', 'system.attributes.ac.value': 'prepared',
      'system.attributes.hp.value': 'prepared', 'system.attributes.ac.override': 'stored' });
    assert.deepEqual(value.missingFields, []);
    assert.ok(result.content.length < 1200);
    assert.doesNotMatch(result.content, /xxxxx|equippedArmor|unrelated/);
    // A prepared-only change must not contaminate stored-data mutation prerequisites.
    prepared.attributes.ac.value = 19;
    documentReadRegistry.requireReadForModification('Actor', 'warrior', await DocumentAPI.getDocument('Actor', 'warrior', { pack }), pack);
    const modified = payload(await tool.execute({ documentType: 'Actor', documentId: 'warrior', ...(pack ? { pack } : {}), fields: ['system.attributes.ac.value'] }));
    assert.equal(modified.fields['system.attributes.ac.value'], 19);
    prepared.attributes.ac.value = 15;
  }
});

test('full reads stay stored and missing prepared paths remain explicit without a calculated fallback', async t => {
  const { prepared, stored } = setup(t);
  const tool = new DocumentReadTool();
  const full = payload(await tool.execute({ documentType: 'Actor', documentId: 'warrior' }));
  assert.equal(full.system.attributes.ac.value, undefined);
  assert.equal(full.system.attributes.ac.flat, 15);
  delete prepared.attributes.ac.value;
  const missing = payload(await tool.execute({ documentType: 'Actor', documentId: 'warrior', fields: ['system.attributes.ac.value'] }));
  assert.deepEqual(missing.missingFields, ['system.attributes.ac.value']);
  assert.equal(missing.fields['system.attributes.ac.value'], undefined, 'flat is not silently substituted for computed AC');
  const unchanged = await DocumentAPI.getDocument('Actor', 'warrior');
  documentReadRegistry.requireReadForModification('Actor', 'warrior', unchanged);
  stored.system.attributes.hp.value = 9;
  const changed = await DocumentAPI.getDocument('Actor', 'warrior');
  assert.throws(() => documentReadRegistry.requireReadForModification('Actor', 'warrior', changed), /changed|stale|modified/i);
});

test('world permission denial prevents exposure of prepared data', async t => {
  const { world } = setup(t);
  game.user.isGM = false;
  world.testUserPermission = () => false;
  let observed = false;
  await assert.rejects(DocumentAPI.getDocument('Actor', 'warrior', { onPreparedSystem: () => { observed = true; } }), /Permission denied/);
  assert.equal(observed, false);
});
