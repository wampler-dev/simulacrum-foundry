import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { InteractionLogger } = await import('../../scripts/core/interaction-logger.js');

function fixture(t, debug = false) {
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  const oldConfig = Object.getOwnPropertyDescriptor(globalThis, 'CONFIG');
  let saved;
  globalThis.CONFIG = { debug: { simulacrum: debug } };
  globalThis.game = { world: { id: 'world' }, user: {
    setFlag: async (_scope, _key, state) => { saved = structuredClone(state); },
    getFlag: async () => saved,
  }, settings: { get: () => 'private custom prompt' } };
  const log = new InteractionLogger();
  t.after(() => {
    clearTimeout(log._saveDebounceTimer);
    if (oldGame) Object.defineProperty(globalThis, 'game', oldGame); else delete globalThis.game;
    if (oldConfig) Object.defineProperty(globalThis, 'CONFIG', oldConfig); else delete globalThis.CONFIG;
  });
  return { log, getSaved: () => saved, setSaved: value => { saved = value; } };
}

test('ordinary logging persists status and timing without duplicating large content', async t => {
  const { log, getSaved } = fixture(t);
  const secret = 'private payload '.repeat(15000);
  log.logMessage({ role: 'user', content: secret });
  log.logMessage({ role: 'assistant', content: secret }, { toolCalls: [{ id: 'one' }] });
  log.logToolCall('read_document', { privateData: secret }, 'one');
  log.logToolResult('one', { content: secret }, false, 17);
  log.logLoopEvent('loop', 'loop_ended', { reason: 'provider_failure' });
  await log.save();
  const saved = JSON.stringify(getSaved());
  assert.ok(saved.length < 3000);
  assert.doesNotMatch(saved, /private payload/);
  assert.equal(getSaved().entries.at(-2).metadata.success, false);
  assert.equal(getSaved().entries.at(-2).metadata.durationMs, 17);
  assert.equal(log.entryCount, 5);
  assert.doesNotMatch(log.export(), /private custom prompt/);
  log.logLoopEvent('loop', 'failed', { verbose: secret });
  await log.save();
  assert.ok(JSON.stringify(getSaved()).length < 4200);
});

test('debug previews and imported legacy entries are bounded before re-saving', async t => {
  const { log, getSaved, setSaved } = fixture(t, true);
  const secret = 'Z'.repeat(100000);
  log.logToolCall('search_documents', { query: secret }, 'one');
  log.logToolResult('one', { content: secret }, true, 11);
  await log.save();
  assert.ok(JSON.stringify(getSaved()).length < 1600);
  assert.match(JSON.stringify(getSaved()), /truncated/);
  setSaved({ entries: Array.from({ length: 600 }, (_, index) => ({
    type: 'tool_result', content: secret, metadata: { toolCallId: `old-${index}`, success: true, durationMs: 10 },
  })) });
  await log.load();
  assert.equal(log.entryCount, 500);
  await log.save();
  assert.ok(getSaved().entries.every(entry => !entry.content || entry.content.length < 520));
  globalThis.CONFIG.debug.simulacrum = false;
  await log.save();
  assert.ok(getSaved().entries.every(entry => entry.content === null));
  assert.ok(log.getEntries().every(entry => entry.content === null));
  assert.ok(JSON.parse(log.export()).entries.every(entry => entry.content === null));
});
