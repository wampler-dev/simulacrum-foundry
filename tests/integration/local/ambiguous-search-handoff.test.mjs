import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.FormApplication = class {};
const { DocumentSearchTool } = await import('../../../scripts/tools/document-search.js');
const { ToolRegistry, toolRegistry } = await import('../../../scripts/core/tool-registry.js');
const { DocumentAPI } = await import('../../../scripts/core/document-api.js');
const { executeToolCalls } = await import('../../../scripts/core/tool-execution.js');
const { interactionLogger } = await import('../../../scripts/core/interaction-logger.js');
const { ConversationManager } = await import('../../../scripts/core/conversation.js');

test('three-source ambiguity reaches persisted model history without compaction or suggested read action', async t => {
  const previous = globalThis.game;
  let saved;
  t.after(() => { globalThis.game = previous; });
  const packages = ['dnd5e', 'dnd-heroes-borderlands', 'dnd-monster-manual'];
  const titles = ['Dungeons & Dragons Fifth Edition', 'Heroes of the Borderlands', 'Dungeons & Dragons Monster Manual'];
  const packs = packages.map(id => `${id}.${id === 'dnd5e' ? 'actors24' : 'actors'}`);
  globalThis.game = { packs: new Map(packs.map(id => [id, { title: 'Actors' }])),
    modules: new Map(packages.map((id, i) => [id, { title: titles[i] }])),
    user: { isGM: true, setFlag: async (_scope, _key, state) => { saved = structuredClone(state); } } };
  t.mock.method(DocumentAPI, 'searchDocuments', async () => packs.flatMap(pack =>
    ['Goblin Warrior', 'Hobgoblin Warrior'].map((name, i) => ({ name, pack, type: 'Actor',
      _id: i ? 'mmHobgoblinWarri' : 'mmGoblinWarrior0',
      uuid: `Compendium.${pack}.Actor.${i ? 'mmHobgoblinWarri' : 'mmGoblinWarrior0'}` }))));
  const registry = new ToolRegistry();
  registry.registerTool(new DocumentSearchTool());
  t.mock.method(toolRegistry, 'executeTool', registry.executeTool.bind(registry));
  t.mock.method(interactionLogger, 'logToolCall', () => {});
  t.mock.method(interactionLogger, 'logToolResult', () => {});
  const conversation = new ConversationManager('user', 'world');
  const call = { id: 'ambiguous', type: 'function', function: { name: 'search_documents',
    arguments: JSON.stringify({ query: 'Goblin Warrior', documentTypes: ['Actor'] }) } };
  conversation.addMessage('assistant', '', [call]);
  await executeToolCalls([call], { conversationManager: conversation, currentToolSupport: true,
    allowedToolNames: new Set(['search_documents']), onToolResult: async () => {} });
  const envelope = JSON.parse(saved.activeMessages.at(-1).content);
  assert.equal(envelope._compacted, undefined);
  const body = JSON.parse(envelope.content);
  assert.equal(body.status, 'ambiguous');
  assert.deepEqual(body.candidates.map(c => c.source), packs);
  assert.deepEqual(body.candidates.map(c => c.packageTitle), titles);
  assert.ok(body.candidates.every(c => !Object.hasOwn(c, 'read_document')));
  assert.match(body.guidance, /Ask the user/);
  assert.equal(conversation.toolOutputBuffer.size, 0);
});
