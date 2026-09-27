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
