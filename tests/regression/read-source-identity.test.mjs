import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentReadRegistry, documentReadRegistry } from '../../scripts/utils/document-read-registry.js';
import { DocumentAPI } from '../../scripts/core/document-api.js';
import { DocumentReadTool } from '../../scripts/tools/document-read.js';
import { DocumentUpdateTool } from '../../scripts/tools/document-update.js';
import { DocumentDeleteTool } from '../../scripts/tools/document-delete.js';

test('world and multiple packs sharing a raw ID have separate read and stale states', () => {
  const registry = new DocumentReadRegistry();
  const data = { _id: 'shared', name: 'Hero' };
  registry.registerRead('Actor', 'shared', data);
  registry.requireReadForModification('Actor', 'shared', data);
  for (const pack of ['world.a', 'world.b']) {
    assert.equal(registry.hasBeenRead('Actor', 'shared', pack), false);
    assert.throws(() => registry.requireReadForModification('Actor', 'shared', data, pack), { code: 'DOCUMENT_NOT_READ' });
  }
  registry.registerRead('Actor', 'shared', data, 'world.a');
  registry.registerRead('Actor', 'shared', data, 'world.b');
  registry.unregister('Actor', 'shared', 'world.a');
  assert.equal(registry.hasBeenRead('Actor', 'shared', 'world.a'), false);
  assert.equal(registry.hasBeenRead('Actor', 'shared', 'world.b'), true);
  registry.requireReadForModification('Actor', 'shared', data);
  assert.throws(() => registry.requireReadForModification('Actor', 'shared', { ...data, name: 'Changed' }, 'world.b'), { code: 'DOCUMENT_STALE' });
});

test('read, update, and delete honor source identity with identical document data', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = {
    user: { isGM: true }, documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', { get: () => ({}) }]]),
    packs: new Map(['world.a', 'world.b'].map(id => [id, { documentName: 'Actor', locked: false }])),
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
    documentReadRegistry.clear();
  });
  const data = { _id: 'shared', name: 'Hero' };
  t.mock.method(DocumentAPI, 'getDocument', async () => data);
  let deleted = 0;
  t.mock.method(DocumentAPI, 'deleteDocument', async () => { deleted++; });
  const read = new DocumentReadTool();
  const update = new DocumentUpdateTool();
  const del = new DocumentDeleteTool();
  assert.equal((await read.execute({ documentType: 'Actor', documentId: 'shared', pack: 'world.a' })).error, undefined);
  const params = { documentType: 'Actor', documentId: 'shared', pack: 'world.b' };
  assert.equal((await update.execute({ ...params, updates: { name: 'Changed' } })).error?.type, 'DOCUMENT_NOT_READ');
  assert.equal((await del.execute({ ...params })).error?.type, 'DOCUMENT_NOT_READ');
  assert.equal(deleted, 0);
  assert.equal((await read.execute(params)).error, undefined);
  assert.equal((await del.execute(params)).error, undefined);
  assert.equal(deleted, 1);
  assert.equal(documentReadRegistry.hasBeenRead('Actor', 'shared', 'world.a'), true);
  assert.equal(documentReadRegistry.hasBeenRead('Actor', 'shared', 'world.b'), false);
});
