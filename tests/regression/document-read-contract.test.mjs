import assert from 'node:assert/strict';
import test from 'node:test';

const { DocumentAPI } = await import('../../scripts/core/document-api.js');
const { DocumentReadTool } = await import('../../scripts/tools/document-read.js');
const { documentReadRegistry } = await import('../../scripts/utils/document-read-registry.js');

function setup(t, large = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'game');
  class Actor {
    static metadata = { embedded: { Item: 'items', ActiveEffect: 'effects' } };
    constructor(pack) { this.pack = pack; this.uuid = pack ? `Compendium.${pack}.Actor.same` : 'Actor.same'; }
    testUserPermission() { return true; }
    toObject() {
      return { _id: 'same', name: 'Goblin', system: { attributes: { ac: { value: 15 }, hp: { value: 7 } } },
        img: 'portrait.webp', items: [{ _id: 'item', name: 'Sword' }], effects: [{ _id: 'effect' }],
        description: large ? 'x'.repeat(15000) : 'short' };
    }
  }
  const world = new Actor();
  const packed = new Actor('world.monsters');
  globalThis.game = {
    user: { isGM: true }, documentTypes: { Actor: ['npc'] },
    collections: new Map([['Actor', { get: () => world }]]),
    packs: new Map([['world.monsters', { documentName: 'Actor', getDocument: async () => packed }]]),
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'game', previous);
    else delete globalThis.game;
    documentReadRegistry.clear();
  });
}

function payload(result) {
  assert.equal(result.error, undefined, result.error?.message);
  return JSON.parse(result.content.slice(result.content.indexOf('\n\n') + 2));
}

test('world and pack API reads honor embedded option; omitted option preserves existing full behavior', async t => {
  setup(t);
  for (const pack of [undefined, 'world.monsters']) {
    const opts = pack ? { pack } : {};
    const full = await DocumentAPI.getDocument('Actor', 'same', opts);
    assert.equal(full.items.length, 1);
    const trimmed = await DocumentAPI.getDocument('Actor', 'same', { ...opts, includeEmbedded: false });
    assert.equal(Object.hasOwn(trimmed, 'items'), false);
    assert.equal(Object.hasOwn(trimmed, 'effects'), false);
    assert.equal(trimmed.system.attributes.ac.value, 15);
    assert.equal(trimmed.uuid, pack ? 'Compendium.world.monsters.Actor.same' : 'Actor.same');
  }
});

test('read defaults to no embedded, selects exact fields, and reports missing paths', async t => {
  setup(t);
  const tool = new DocumentReadTool();
  const basic = payload(await tool.execute({ documentType: 'Actor', documentId: 'same' }));
  assert.equal(Object.hasOwn(basic, 'items'), false);
  assert.equal(documentReadRegistry.hasBeenRead('Actor', 'same'), true);
  documentReadRegistry.requireReadForModification('Actor', 'same', await DocumentAPI.getDocument('Actor', 'same'));
  const fields = payload(await tool.execute({ documentType: 'Actor', documentId: 'same', pack: 'world.monsters',
    fields: ['system.attributes.ac.value', 'system.attributes.hp.value', 'does.not.exist', 'items'] }));
  assert.deepEqual(fields.fields, { 'system.attributes.ac.value': 15, 'system.attributes.hp.value': 7 });
  assert.deepEqual(fields.missingFields, ['does.not.exist', 'items']);
  assert.equal(fields.pack, 'world.monsters');
  assert.equal(documentReadRegistry.hasBeenRead('Actor', 'same', 'world.monsters'), true);
  const embedded = payload(await tool.execute({ documentType: 'Actor', documentId: 'same', pack: 'world.monsters',
    includeEmbedded: true, fields: ['items'] }));
  assert.equal(embedded.fields.items[0].name, 'Sword');
});

test('oversized full output fails with a field hint; selected reads remain bounded', async t => {
  setup(t, true);
  const tool = new DocumentReadTool();
  const oversized = await tool.execute({ documentType: 'Actor', documentId: 'same' });
  assert.equal(oversized.error.type, 'READ_TOO_LARGE');
  assert.equal(documentReadRegistry.hasBeenRead('Actor', 'same'), false);
  const selected = await tool.execute({ documentType: 'Actor', documentId: 'same', fields: ['name', 'system.attributes.ac.value'] });
  assert.deepEqual(payload(selected).fields, { name: 'Goblin', 'system.attributes.ac.value': 15 });
  assert.ok(selected.content.length < 12000);
  const invalidPage = await tool.execute({ documentType: 'Actor', documentId: 'same', startLine: 50000 });
  assert.equal(invalidPage.error.type, 'UNKNOWN_ERROR');
});

test('published read examples validate and execute against matching world and pack fixtures', async t => {
  setup(t);
  const tool = new DocumentReadTool();
  const examples = tool.getExamples();
  assert.equal(examples.length, 3);
  for (const example of examples) {
    const parameters = { ...example.parameters, documentId: 'same' };
    tool.validateParameters(parameters, tool.schema);
    const result = await tool.execute(parameters);
    assert.equal(result.error, undefined, `${example.description}: ${result.error?.message}`);
    const data = payload(result);
    if (parameters.pack) assert.equal(data.name, 'Goblin');
    if (parameters.fields) assert.equal(data.fields['system.attributes.ac.value'], 15);
  }
});
