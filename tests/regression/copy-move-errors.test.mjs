import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.FormApplication = class {};
const { DocumentCopyTool } = await import('../../scripts/tools/document-copy.js');
const { DocumentMoveTool } = await import('../../scripts/tools/document-move.js');
const { toolRegistry } = await import('../../scripts/core/tool-registry.js');

const args = {
  documentType: 'Actor', sourceId: 'source',
  sourceLocation: { type: 'world' }, targetLocation: { type: 'compendium', pack: 'test.actors' },
};

test('copy returns a useful error when source is missing', async () => {
  const tool = new DocumentCopyTool();
  tool.setDocumentAPI({ getDocument: async () => null });
  const result = await tool.execute(args);
  assert.match(result.error.message, /Source document not found: source/);
  assert.equal(result.error.type, 'NotFoundError');
});

test('copy returns original creation failure without masking it', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'foundry');
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'foundry', previous);
    else delete globalThis.foundry;
  });
  const tool = new DocumentCopyTool();
  tool.setDocumentAPI({
    getDocument: async () => ({ _id: 'source', name: 'Hero' }),
    createDocument: async () => { throw new Error('write refused'); },
  });
  const result = await tool.execute({ ...args, targetLocation: { type: 'world' } });
  assert.match(result.error.message, /Copy failed: write refused/);
  assert.doesNotMatch(result.error.message, /createErrorResponse|not a function/);
  assert.equal(result.partial.destinationState, 'unknown');
  assert.equal(result.partial.sourceState, 'unchanged');
});

test('move preserves copy failure and never deletes source', async t => {
  let deletions = 0;
  t.mock.method(toolRegistry, 'getTool', () => ({ execute: async () => ({
    content: 'source not found', error: { message: 'source not found', type: 'NotFoundError' },
  }) }));
  const tool = new DocumentMoveTool();
  tool.setDocumentAPI({ deleteDocument: async () => { deletions++; } });
  const result = await tool.execute(args);
  assert.match(result.error.message, /Copy phase failed: source not found/);
  assert.equal(deletions, 0);
});

test('move reports a successful copy and uncertain source after deletion fails', async t => {
  let copies = 0;
  t.mock.method(toolRegistry, 'getTool', () => ({ execute: async () => {
    copies++;
    return { content: '{"newId":"copy-1","name":"Hero"}', display: 'Copied',
      document: { id: 'copy-1', name: 'Hero', documentType: 'Actor', destination: args.targetLocation } };
  } }));
  const tool = new DocumentMoveTool();
  tool.setDocumentAPI({ deleteDocument: async () => { throw new Error('delete refused'); } });
  const result = await tool.execute(args);
  assert.equal(copies, 1);
  assert.match(result.error.message, /delete refused/);
  assert.equal(result.partial?.copyCompleted, true);
  assert.equal(result.partial?.sourceState, 'unknown');
  assert.deepEqual(result.partial?.destination, args.targetLocation);
  assert.equal(result.partial?.document?.id, 'copy-1');
  assert.match(result.display, /check.*source.*destination/i);
});

test('missing copy tool and world-folder update failure return real error responses', async t => {
  t.mock.method(toolRegistry, 'getTool', () => null);
  const tool = new DocumentMoveTool();
  tool.setDocumentAPI({ updateDocument: async () => { throw new Error('update refused'); } });
  const missing = await tool.execute(args);
  assert.match(missing.error.message, /document_copy tool not found/);
  const world = await tool.execute({
    ...args, targetLocation: { type: 'world', folder: 'dest' },
  });
  assert.match(world.error.message, /update refused/);
});
