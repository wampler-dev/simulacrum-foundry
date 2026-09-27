import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { AIClient } = await import('../../scripts/core/ai-client.js');

test('an empty capability set sends a plain chat request without tool_choice', async t => {
  const oldFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Hello!' } }] }) };
  };
  t.after(() => { globalThis.fetch = oldFetch; });
  const client = new AIClient({ baseURL: 'http://localhost:9999/v1', model: 'test-model' });
  const response = await client.chat([{ role: 'user', content: 'Hello!' }], []);
  assert.equal(response.choices[0].message.content, 'Hello!');
  assert.equal(bodies.length, 1);
  assert.equal(Object.hasOwn(bodies[0], 'tools'), false);
  assert.equal(Object.hasOwn(bodies[0], 'tool_choice'), false);
});
