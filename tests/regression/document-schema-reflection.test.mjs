import assert from 'node:assert/strict';
import test from 'node:test';

const { DocumentAPI } = await import('../../scripts/core/document-api.js');

test('schema inspection resolves a top-level type, subtype fields, and embedded class', t => {
  const oldConfig = Object.getOwnPropertyDescriptor(globalThis, 'CONFIG');
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  class Activity {}
  Activity.documentName = 'Activity';
  Activity.schema = { fields: { name: { required: true } } };
  class Actor {}
  Actor.documentName = 'Actor';
  Actor.schema = { fields: { name: { required: true }, system: {} } };
  Actor.hierarchy = { Activity };
  globalThis.CONFIG = {
    Actor: { documentClass: Actor, dataModels: { npc: { schema: { fields: { attributes: { fields: { hp: { required: true } } } } } } } },
  };
  globalThis.game = { system: { id: 'dnd5e' }, documentTypes: { Actor: ['npc'] }, modules: new Map() };
  t.after(() => {
    if (oldConfig) Object.defineProperty(globalThis, 'CONFIG', oldConfig); else delete globalThis.CONFIG;
    if (oldGame) Object.defineProperty(globalThis, 'game', oldGame); else delete globalThis.game;
  });
  const actor = DocumentAPI.getDocumentSchema('Actor', 'npc');
  assert.equal(actor.type, 'Actor');
  assert.deepEqual(actor.systemFields, ['attributes']);
  assert.equal(actor.systemFieldDetails.attributes.nested.hp.required, true);
  assert.deepEqual(actor.embedded, ['Activity']);
  const embedded = DocumentAPI.getDocumentSchema('Activity');
  assert.equal(embedded.type, 'Activity');
  assert.ok(embedded.fields.includes('name'));
});
