import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { DocumentListTool } = await import('../../../scripts/tools/document-list.js');
const { ToolRegistry, toolRegistry } = await import('../../../scripts/core/tool-registry.js');
const { executeToolCalls } = await import('../../../scripts/core/tool-execution.js');
const { interactionLogger } = await import('../../../scripts/core/interaction-logger.js');
const { ConversationManager } = await import('../../../scripts/core/conversation.js');

function setup(t, sourceCount = 12, packsPerSource = 7) {
  const previous = globalThis.game;
  let saved;
  t.after(() => { globalThis.game = previous; });
  const modules = new Map();
  const packs = [];
  for (let i = 0; i < sourceCount; i++) {
    const id = i === 0 ? 'dnd5e' : i === 1 ? 'dnd-monster-manual' : i === 2 ? 'dnd-dungeon-masters-guide' : `source-${i}`;
    modules.set(id, { title: i === 1 ? 'Dungeons & Dragons Monster Manual' :
      i === 2 ? '2024 Dungeon Master’s Guide' : `Source ${i}` });
    for (let j = 0; j < packsPerSource; j++) packs.push({
      collection: `${id}.${j === 0 ? 'actors' : `pack${j}`}`, metadata: { packageName: id, title: j === 0 ? 'Actors' : `Pack ${j}` },
      documentName: j === 0 ? 'Actor' : 'Item', index: { size: 500 },
      testUserPermission: (_user, level) => level === 'OBSERVER',
      getIndex: () => { throw new Error('Discovery must not load indexes'); },
    });
  }
  globalThis.game = { packs, modules, user: { isGM: true,
    setFlag: async (_scope, _key, state) => { saved = structuredClone(state); }, getFlag: async () => saved } };
  const registry = new ToolRegistry();
  registry.registerTool(new DocumentListTool());
  t.mock.method(toolRegistry, 'executeTool', registry.executeTool.bind(registry));
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  t.mock.method(interactionLogger, 'logToolResult', () => {});
  const conversation = new ConversationManager('user', 'world');
  let n = 0;
  return async args => {
    const call = { id: `list-${++n}`, type: 'function', function: { name: 'list_documents', arguments: JSON.stringify({ ...args, justification: 'Discover the requested source' }) } };
    conversation.addMessage('assistant', '', [call]);
    const results = await executeToolCalls([call], { conversationManager: conversation, currentToolSupport: true,
      allowedToolNames: new Set(['list_documents']), onToolResult: async () => {} });
    assert.equal(results[0].success, true);
    const message = saved.activeMessages.at(-1);
    const envelope = JSON.parse(message.content);
    assert.equal(envelope._compacted, undefined);
    assert.ok(message.content.length <= 3500);
    assert.equal(conversation.toolOutputBuffer.size, 0);
    return JSON.parse(envelope.content);
  };
}

test('large catalog preserves Monster Manual source and Actor pack through real dispatch and persisted history', async t => {
  const call = setup(t); // 84 packs: larger than the failing live catalog.
  const sources = await call({ documentType: 'Compendium' });
  assert.equal(sources.kind, 'sources');
  assert.equal(sources.total, 12);
  assert.equal(sources.nextPage, null);
  const manual = sources.entries.find(e => e.title === 'Dungeons & Dragons Monster Manual');
  assert.equal(manual.packageId, 'dnd-monster-manual');
  const selected = await call({ documentType: 'Compendium', packageId: manual.packageId });
  assert.equal(selected.kind, 'packs');
  assert.equal(selected.entries.find(e => e.documentType === 'Actor').pack, 'dnd-monster-manual.actors');
  assert.doesNotMatch(JSON.stringify(selected), /dnd5e\./);
});

test('module IDs in the pack input return bounded source pack choices without loading documents', async t => {
  const call = setup(t);
  const sources = await call({ documentType: 'Compendium', filters: { name: 'Monster Manual' } });
  assert.equal(sources.kind, 'sources');
  assert.equal(sources.total, 12, 'the current catalog mode does not apply document filters');
  for (const packageId of ['dnd-monster-manual', 'dnd-dungeon-masters-guide']) {
    const result = await call({ documentType: 'Actor', pack: packageId });
    assert.equal(result.kind, 'packs');
    assert.equal(result.packageId, packageId);
    assert.equal(result.total, 7);
    assert.deepEqual(result.entries.filter(entry => entry.documentType === 'Actor').map(entry => entry.pack),
      [`${packageId}.actors`]);
    assert.match(result.guidance, /exact pack ID/);
  }
});

test('oversized source and pack catalogs page without loss or generic compaction', async t => {
  const call = setup(t, 35, 35);
  const sources = [];
  let args = { documentType: 'Compendium' };
  do {
    const page = await call(args);
    sources.push(...page.entries);
    args = page.nextPage;
  } while (args);
  assert.equal(sources.length, 35);
  assert.equal(new Set(sources.map(e => e.packageId)).size, 35);
  const packs = [];
  args = { documentType: 'Compendium', packageId: 'dnd-monster-manual' };
  do {
    const page = await call(args);
    packs.push(...page.entries);
    args = page.nextPage;
  } while (args);
  assert.equal(packs.length, 35);
  assert.equal(new Set(packs.map(e => e.pack)).size, 35);
});

test('invalid discovery cursors and sources fail explicitly; oversized identity is never truncated', async t => {
  setup(t, 1, 1);
  const tool = new DocumentListTool();
  for (const params of [{ pageOffset: -1 }, { pageOffset: 2 }, { packageId: 'missing' }]) {
    assert.equal((await tool.execute({ documentType: 'Compendium', ...params })).error.type, 'DISCOVERY_FAILED');
  }
  game.packs[0].metadata.packageName = 'x'.repeat(5000);
  assert.equal((await tool.execute({ documentType: 'Compendium' })).error.type, 'DISCOVERY_FAILED');
});
