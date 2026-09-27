import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentCreateTool } from '../../scripts/tools/document-create.js';
import { DocumentAPI } from '../../scripts/core/document-api.js';

test('unknown create fields return targeted bounded correction before any mutation', async t => {
  const oldConfig = Object.getOwnPropertyDescriptor(globalThis, 'CONFIG');
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  class Actor {}
  Actor.schema = { fields: { name: {}, system: {},
    ...Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`field${i}`, {}])) } };
  globalThis.CONFIG = { Actor: { documentClass: Actor } };
  globalThis.game = { documentTypes: { Actor: ['npc'] }, collections: new Map([['Actor', {}]]) };
  t.after(() => {
    if (oldConfig) Object.defineProperty(globalThis, 'CONFIG', oldConfig); else delete globalThis.CONFIG;
    if (oldGame) Object.defineProperty(globalThis, 'game', oldGame); else delete globalThis.game;
  });
  let creates = 0;
  t.mock.method(DocumentAPI, 'createDocument', async () => { creates++; });
  const result = await new DocumentCreateTool().execute({ documentType: 'Actor',
    data: { name: 'Goblin', type: 'npc', hitPoints: 7 } });
  assert.equal(result.error.type, 'UNKNOWN_FIELDS');
  assert.deepEqual(result.error.unknownFields, ['hitPoints']);
  assert.equal(Object.hasOwn(result.error, 'schema'), false);
  assert.match(result.content, /unknown top-level fields: hitPoints/);
  assert.match(result.content, /Valid top-level fields include: name, system/);
  assert.match(result.content, /72 more; inspect_document_schema/);
  assert.ok(JSON.stringify(result).length < 1100);
  assert.equal(creates, 0);
});
