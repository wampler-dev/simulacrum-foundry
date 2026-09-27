import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentReadTool } from '../../scripts/tools/document-read.js';

test('read_document decomposes a full compendium UUID mechanically', () => {
  const tool = new DocumentReadTool();
  assert.deepEqual(
    tool._resolveReferenceParameters(
      'Compendium.dnd-monster-manual.actors.Actor.mmGoblinWarrior0',
      'Actor',
      'dnd-monster-manual.actors'
    ),
    {
      pack: 'dnd-monster-manual.actors',
      documentType: 'Actor',
      documentId: 'mmGoblinWarrior0',
    }
  );
});

test('read_document can infer pack and type from a full compendium UUID', () => {
  const tool = new DocumentReadTool();
  assert.deepEqual(
    tool._resolveReferenceParameters(
      'Compendium.dnd-monster-manual.actors.Actor.mmGoblinWarrior0'
    ),
    {
      pack: 'dnd-monster-manual.actors',
      documentType: 'Actor',
      documentId: 'mmGoblinWarrior0',
    }
  );
});

test('read_document still accepts raw IDs unchanged', () => {
  const tool = new DocumentReadTool();
  assert.deepEqual(
    tool._resolveReferenceParameters(
      'mmGoblinWarrior0',
      'Actor',
      'dnd-monster-manual.actors'
    ),
    {
      pack: 'dnd-monster-manual.actors',
      documentType: 'Actor',
      documentId: 'mmGoblinWarrior0',
    }
  );
});


test('targeted field selection returns exact dot paths only', () => {
  const tool = new DocumentReadTool();
  const data = {
    name: 'Goblin Warrior',
    system: {
      attributes: {
        ac: { value: 15 },
        hp: { value: 7, max: 7 },
      },
      abilities: { str: { value: 8 } },
    },
  };

  assert.deepEqual(
    tool._selectFields(data, ['system.attributes.ac', 'system.attributes.hp']),
    {
      'system.attributes.ac': { value: 15 },
      'system.attributes.hp': { value: 7, max: 7 },
    }
  );
});

test('unknown targeted fields are omitted without inventing values', () => {
  const tool = new DocumentReadTool();
  const data = { system: { attributes: { hp: { value: 7 } } } };

  assert.deepEqual(
    tool._selectFields(data, ['system.attributes.hp', 'system.attributes.nope']),
    { 'system.attributes.hp': { value: 7 } }
  );
});

test('empty field selection preserves full-document behavior', () => {
  const tool = new DocumentReadTool();
  const data = { name: 'Goblin Warrior', system: { attributes: { hp: { value: 7 } } } };
  assert.equal(tool._selectFields(data, []), data);
});
