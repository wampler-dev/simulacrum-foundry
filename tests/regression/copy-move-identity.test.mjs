import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.FormApplication = class {};
const { DocumentCopyTool } = await import('../../scripts/tools/document-copy.js');
const { DocumentMoveTool } = await import('../../scripts/tools/document-move.js');
const { toolRegistry } = await import('../../scripts/core/tool-registry.js');

const args = {
  documentType: 'Actor', sourceId: 'source',
  sourceLocation: { type: 'world' }, targetLocation: { type: 'world' },
};

function cloneSetup(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'foundry');
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'foundry', previous);
    else delete globalThis.foundry;
  });
}

test('copy returns the created world document ID, including names requiring JSON escaping', async t => {
  cloneSetup(t);
  const tool = new DocumentCopyTool();
  tool.setDocumentAPI({
    getDocument: async () => ({ _id: 'source', name: 'Hero' }),
    createDocument: async () => ({ id: 'real-id', name: 'Hero "the Brave"' }),
  });
  const result = await tool.execute(args);
  assert.equal(result.document.id, 'real-id');
  assert.equal(JSON.parse(result.content).name, 'Hero "the Brave"');
});

test('embedded target rejects before copy or deletion and no placeholder ID is returned', async t => {
  let reads = 0;
  let writes = 0;
  const tool = new DocumentCopyTool();
  tool.setDocumentAPI({ getDocument: async () => { reads++; }, applyEmbeddedOperations: async () => { writes++; } });
  const targetLocation = { type: 'embedded', parentType: 'Actor', parentId: 'parent' };
  const copy = await tool.execute({ ...args, targetLocation });
  assert.equal(copy.error.type, 'UNSUPPORTED_TARGET');
  assert.equal(reads + writes, 0);
  const move = new DocumentMoveTool();
  move.setDocumentAPI({ deleteDocument: async () => { writes++; } });
  const moved = await move.execute({ ...args, targetLocation });
  assert.equal(moved.error.type, 'UNSUPPORTED_LOCATION');
  assert.equal(writes, 0);
});

test('move uses structured destination identity and stops if it is missing', async t => {
  let deleted = 0;
  const destination = { type: 'compendium', pack: 'world.heroes' };
  const source = { ...args, targetLocation: destination };
  let copyResult = { content: '{"newId":"fabricated"}', display: 'Copied' };
  t.mock.method(toolRegistry, 'getTool', () => ({ execute: async () => copyResult }));
  const move = new DocumentMoveTool();
  move.setDocumentAPI({ deleteDocument: async () => { deleted++; } });
  const uncertain = await move.execute(source);
  assert.equal(uncertain.error.type, 'UNKNOWN_DESTINATION');
  assert.equal(uncertain.partial.sourceState, 'unchanged');
  assert.equal(deleted, 0);

  copyResult = { content: 'unparseable text', document: {
    id: 'actual-id', name: 'Hero', documentType: 'Actor', destination,
  } };
  const done = await move.execute(source);
  assert.equal(done.error, undefined);
  assert.equal(JSON.parse(done.content).newId, 'actual-id');
  assert.equal(deleted, 1);
});

test('copy with missing returned ID reports uncertain destination without claiming success', async t => {
  cloneSetup(t);
  const tool = new DocumentCopyTool();
  tool.setDocumentAPI({
    getDocument: async () => ({ _id: 'source', name: 'Hero' }),
    createDocument: async () => ({ name: 'Hero' }),
  });
  const result = await tool.execute(args);
  assert.equal(result.error.type, 'UNKNOWN_DESTINATION');
  assert.equal(result.partial.sourceState, 'unchanged');
});

test('move rejects a locked source pack before creating a destination', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { packs: new Map([['world.locked', { locked: true }]]) };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
  });
  let copies = 0;
  t.mock.method(toolRegistry, 'getTool', () => ({ execute: async () => { copies++; } }));
  const move = new DocumentMoveTool();
  move.setDocumentAPI({ deleteDocument: async () => { throw new Error('unexpected delete'); } });
  const result = await move.execute({
    ...args, sourceLocation: { type: 'compendium', pack: 'world.locked' },
  });
  assert.equal(result.error.type, 'SOURCE_UNAVAILABLE');
  assert.equal(copies, 0);
});
