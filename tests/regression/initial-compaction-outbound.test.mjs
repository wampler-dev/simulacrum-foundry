import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.FormApplication = class {};
const { SimulacrumCore } = await import('../../scripts/core/simulacrum-core.js');
const { ConversationManager } = await import('../../scripts/core/conversation.js');

const tokenizer = { estimateMessageTokens: message => Math.ceil(String(message?.content || '').length / 4) };

test('initial provider request uses compacted managed history and the new summary once', async t => {
  const oldManager = SimulacrumCore.conversationManager;
  const oldClient = SimulacrumCore.aiClient;
  const previousGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { settings: { get: (_scope, key) => key === 'legacyMode' ? false : key === 'fallbackContextLimit' ? 1000 : undefined } };
  t.after(() => {
    SimulacrumCore.conversationManager = oldManager;
    SimulacrumCore.aiClient = oldClient;
    if (previousGame) Object.defineProperty(globalThis, 'game', previousGame);
    else delete globalThis.game;
  });
  const conversation = new ConversationManager('user', 'world', 1000, tokenizer);
  for (let i = 0; i < 10; i++) conversation.addMessage('user', `old-${i} ${'x'.repeat(100)}`);
  conversation.addMessage('user', 'latest question');
  const initialMessages = conversation.getMessages();
  const outbound = [];
  let summaries = 0;
  SimulacrumCore.conversationManager = conversation;
  t.mock.method(SimulacrumCore, 'getSystemPrompt', async () =>
    `${conversation.rollingSummary ? `Summary: ${conversation.rollingSummary}\n` : ''}Short system prompt`
  );
  SimulacrumCore.aiClient = {
    chat: async () => {
      summaries++;
      return { choices: [{ message: { content: 'Summary of earlier questions.' } }] };
    },
    chatWithSystem: async (messages, getPrompt) => {
      outbound.push({ messages: [...messages], prompt: getPrompt() });
      return { choices: [{ message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }] };
    },
  };
  await SimulacrumCore.generateResponse(initialMessages, { tools: null });
  assert.ok(summaries > 0);
  assert.equal(outbound.length, 1);
  assert.deepEqual(outbound[0].messages, conversation.getMessages());
  assert.ok(outbound[0].messages.length < initialMessages.length);
  assert.equal(outbound[0].messages.some(message => message.content.startsWith('old-0 ')), false);
  assert.equal(outbound[0].messages.at(-1).content, 'latest question');
  assert.equal(conversation.rollingSummary, 'Summary of earlier questions.');
  assert.equal(outbound[0].prompt.match(/Summary of earlier questions\./g)?.length, 1);
});

test('explicit standalone messages remain the outbound input', async t => {
  const oldManager = SimulacrumCore.conversationManager;
  const oldClient = SimulacrumCore.aiClient;
  const previousGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  globalThis.game = { settings: { get: (_scope, key) => key === 'legacyMode' ? false : undefined } };
  t.after(() => {
    SimulacrumCore.conversationManager = oldManager;
    SimulacrumCore.aiClient = oldClient;
    if (previousGame) Object.defineProperty(globalThis, 'game', previousGame);
    else delete globalThis.game;
  });
  const conversation = new ConversationManager('user', 'world', 1000, tokenizer);
  conversation.addMessage('user', 'managed');
  SimulacrumCore.conversationManager = conversation;
  const explicit = [{ role: 'user', content: 'standalone' }];
  let outbound;
  SimulacrumCore.aiClient = {
    chatWithSystem: async messages => {
      outbound = messages;
      return { choices: [{ message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }] };
    },
  };
  await SimulacrumCore.generateResponse(explicit, { systemPrompt: 'Short', tools: null });
  assert.equal(outbound, explicit);
});
