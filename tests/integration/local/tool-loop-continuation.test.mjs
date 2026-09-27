// Integration test for the tool-loop continuation guarantee (issue #178).
//
// Exercises processToolCallLoop end-to-end with fakes for the AI client, the
// tool registry and the conversation manager. Verifies bounded continuation,
// cancellation, and truthful terminal failures.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// --- Foundry globals, stubbed before the module-under-test is imported. ---
globalThis.foundry = { utils: { randomID: () => 'test-id' } };
globalThis.Hooks = { callAll: () => {}, call: () => {} };
globalThis.game = {
  world: { id: 'test-world' },
  user: { getFlag: async () => null, setFlag: async () => {} },
  settings: {
    get: (scope, key) => (key === 'toolLoopLimit' ? 10 : key === 'legacyMode' ? false : undefined),
  },
  i18n: { localize: key => key },
};
globalThis.FormApplication = class {
  static get defaultOptions() {
    return {};
  }

  render() {}
};
globalThis.ui = { notifications: { error: () => {} } };
globalThis.CONFIG = { debug: {} };

const { processToolCallLoop, getToolStepLimit, DEFAULT_TOOL_STEP_LIMIT, MAX_TOOL_STEP_LIMIT } = await import('../../../scripts/core/tool-loop-handler.js');
const { toolRegistry } = await import('../../../scripts/core/tool-registry.js');
const { interactionLogger } = await import('../../../scripts/core/interaction-logger.js');
const { COMPACTION_STATUS } = await import('../../../scripts/core/conversation.js');
const { normalizeAIResponse } = await import('../../../scripts/utils/ai-normalization.js');

// Terminal reasons the loop is contractually allowed to emit (#178).
const KNOWN_REASONS = [
  'end_loop',
  'assistant_response',
  'repeat_limit',
  'circuit_breaker',
  'provider_failure',
  'tool_call_failure',
  'tool_execution_failure',
  'action_not_executed',
  'parse_error',
  'cancelled',
];

before(() => {
  toolRegistry.registerDefaults();
  // Bypass real tool implementations; the loop only inspects `execution.result`.
  toolRegistry.executeTool = async name =>
    name === 'end_loop'
      ? { result: { _endLoop: true } }
      : { result: { success: true, toolName: name, data: 'ok' } };
});

function makeAbortError() {
  return Object.assign(new Error('Process was cancelled'), { name: 'AbortError' });
}

// OpenAI-style raw response normalizing to a single tool call.
function rawToolCall(id, name, args) {
  return {
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

// OpenAI-style raw text response (no tool calls).
function rawText(content) {
  return {
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

// Build an aiClient whose chatWithSystem behavior is scripted per call.
//   steps: one descriptor per chatWithSystem call: a raw response, 'fail', or 'hang'.
//   opts.fallback: returned only on the fallback path (tools === null).
//   opts.failMessage: message thrown for 'fail' descriptors.
function createAiClient(steps, counter, opts = {}) {
  let index = 0;
  return {
    async chatWithSystem(_messages, _getSystemPrompt, tools, callOpts) {
      counter.calls += 1;
      const signal = callOpts?.signal;
      if (signal?.aborted) throw makeAbortError();
      if (tools === null) return opts.fallback;
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === 'fail') throw new Error(opts.failMessage || 'boom');
      if (step === 'hang') {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(makeAbortError()));
        });
      }
      return step;
    },
  };
}

// Mirror ConversationManager.addMessage(role, content, toolCalls, toolCallId, metadata);
// the fake only records the fields the loop assertions need.
function createConversationManager() {
  return {
    messages: [],
    addMessage(role, content, toolCalls = null, toolCallId = null) {
      this.messages.push({ role, content, toolCalls, tool_call_id: toolCallId });
    },
    save: async () => {},
    getMessages() {
      return this.messages;
    },
    estimatePromptOverhead: () => 0,
    compactHistory: async () => COMPACTION_STATUS.WITHIN_BUDGET,
    toolOutputBuffer: new Map(),
  };
}

// Drive the loop with fresh fakes; returns the in-flight promise + observables.
function startLoop(initialResponse, steps, stepOpts = {}, controller) {
  const counter = { calls: 0, failMessage: 'boom' };
  const signal = controller ? controller.signal : new AbortController().signal;
  const aiClient = createAiClient(steps, counter, stepOpts);
  const conversation = createConversationManager();
  const entriesBefore = interactionLogger._entries.length;
  const onToolResultLog = [];
  const onToolPendingLog = [];
  const promise = processToolCallLoop({
    initialResponse,
    conversationManager: conversation,
    aiClient,
    getSystemPrompt: async () => 'test system prompt',
    tools: [],
    currentToolSupport: true,
    signal,
    onToolResult: payload => onToolResultLog.push(payload),
    onToolPending: payload => onToolPendingLog.push(payload),
  });
  return { promise, counter, conversation, entriesBefore, onToolResultLog, onToolPendingLog };
}

function loggedLoopEndedReason(entriesBefore) {
  return interactionLogger._entries.slice(entriesBefore).find(entry => entry.event === 'loop_ended')
    ?.details?.reason;
}

// --- Shared scripted responses ---
const initialResponse1 = normalizeAIResponse(
  rawToolCall('call_1', 'manage_task', {
    action: 'start_task',
    taskName: 'Research the bug',
    taskGoal: 'Reproduce and understand issue #178',
    steps: [
      { title: 'Work', description: 'Reproduce the issue end-to-end' },
      { title: 'Summary', description: 'Document the findings' },
    ],
    justification: 'test',
  })
);
const rawB = rawToolCall('call_2', 'list_documents', { justification: 'test' });
const rawC = rawToolCall('call_3', 'manage_task', {
  action: 'update_task',
  currentStep: 1,
  justification: 'test',
});
const rawD = rawToolCall('call_4', 'manage_task', {
  action: 'finish_task',
  summary: 'done',
  justification: 'test',
});
const rawE = rawToolCall('call_5', 'end_loop', {});

const initialResponse2 = normalizeAIResponse(
  rawToolCall('call_a', 'manage_task', {
    action: 'start_task',
    taskName: 'T',
    taskGoal: 'G',
    steps: [
      { title: 'Work', description: 'w' },
      { title: 'Summary', description: 's' },
    ],
    justification: 'test',
  })
);

const initialResponse3 = normalizeAIResponse(
  rawToolCall('call_3a', 'manage_task', {
    action: 'start_task',
    taskName: 'T',
    taskGoal: 'G',
    steps: [
      { title: 'Work', description: 'w' },
      { title: 'Summary', description: 's' },
    ],
    justification: 'test',
  })
);

test('happy path: exactly one continuation per non-terminal result', async () => {
  const { promise, counter, conversation, entriesBefore, onToolPendingLog } = startLoop(
    initialResponse1,
    [rawB, rawC, rawD, rawE]
  );
  const result = await promise;

  assert.ok(
    KNOWN_REASONS.includes(result._terminalReason),
    `unexpected terminal reason: ${result._terminalReason}`
  );
  assert.ok('_terminalReason' in result, 'returned object carries the field');
  assert.equal(result._terminalReason, 'end_loop');

  // One continuation (chatWithSystem call) per non-terminal result.
  assert.equal(counter.calls, 4, 'one chatWithSystem call per non-terminal result');

  // Every executed tool call commits a matching role:'tool' message.
  const toolMessages = conversation.messages.filter(m => m.role === 'tool');
  assert.equal(toolMessages.length, 5, 'one tool message per executed tool call');
  toolMessages.forEach((m, i) => {
    assert.equal(m.tool_call_id, `call_${i + 1}`, 'tool_call_id matches its call');
  });

  assert.equal(onToolPendingLog.length, 5, 'pending event emitted for every tool call');
  assert.equal(loggedLoopEndedReason(entriesBefore), 'end_loop');
});

test('plain text after a tool ends the turn once and persists the final answer', async () => {
  const { promise, counter, conversation, entriesBefore, onToolResultLog } = startLoop(
    normalizeAIResponse(rawToolCall('call_read', 'read_document', { justification: 'Read the record' })),
    [rawText('The actor has 12 hit points.')]
  );
  const result = await promise;
  assert.equal(result._terminalReason, 'assistant_response');
  assert.equal(result.content, 'The actor has 12 hit points.');
  assert.equal(result._emitted, true);
  assert.equal(counter.calls, 1);
  assert.deepEqual(conversation.messages.filter(message => message.role === 'assistant' && message.content).map(message => message.content), ['The actor has 12 hit points.']);
  assert.equal(conversation.messages.some(message => message.role === 'developer'), false);
  assert.deepEqual(onToolResultLog.filter(message => message.role === 'assistant' && message.content).map(message => message.content), ['The actor has 12 hit points.']);
  assert.equal(loggedLoopEndedReason(entriesBefore), 'assistant_response');
});

test('empty post-tool response is corrected, then a substantive answer ends the turn', async () => {
  const { promise, counter, conversation } = startLoop(
    normalizeAIResponse(rawToolCall('call_empty', 'read_document', { justification: 'Read the record' })),
    [rawText(''), rawText('I found the answer.')]
  );
  const result = await promise;
  assert.equal(result._terminalReason, 'assistant_response');
  assert.equal(counter.calls, 2);
  assert.equal(conversation.messages.filter(message => message.role === 'developer').length, 1);
  assert.equal(conversation.messages.filter(message => message.role === 'assistant' && message.content === 'I found the answer.').length, 1);
});

test(
  'hang + abort: loop rejects with cancellation, never resolves',
  async () => {
    const controller = new AbortController();
    const { promise, entriesBefore } = startLoop(initialResponse2, ['hang'], {}, controller);
    setTimeout(() => controller.abort(), 50);

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    assert.ok(error, 'loop must reject when cancelled, not resolve silently');
    assert.ok(
      error.name === 'AbortError' || /cancel/i.test(error.message),
      'rejection is classified as cancellation'
    );
    assert.ok(KNOWN_REASONS.includes('cancelled'));
    assert.equal(loggedLoopEndedReason(entriesBefore), 'cancelled');
  },
  { timeout: 20000 }
);

test(
  'provider cancellation is terminal without another loop retry',
  async () => {
    const controller = new AbortController();
    const { promise, entriesBefore } = startLoop(
      initialResponse2,
      ['hang'],
      { failMessage: 'boom' },
      controller
    );
    let abortedAt = 0;
    setTimeout(() => {
      abortedAt = Date.now();
      controller.abort();
    }, 200);

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    assert.ok(error, 'loop must reject when cancelled, not resolve silently');
    assert.ok(
      error.name === 'AbortError' || /cancel/i.test(error.message),
      'rejection is classified as cancellation'
    );
    assert.ok(
      Date.now() - abortedAt < 500,
      `loop rejected promptly after abort (${Date.now() - abortedAt}ms)`
    );
    assert.equal(loggedLoopEndedReason(entriesBefore), 'cancelled');
  },
  { timeout: 20000 }
);

test(
  'api failure: one continuation attempt and deterministic terminal error',
  async () => {
    const { promise, conversation, entriesBefore, counter } = startLoop(
      initialResponse3,
      ['fail'],
      { failMessage: 'boom', fallback: rawText('Fabricated success') }
    );
    const result = await promise;

    assert.ok(
      KNOWN_REASONS.includes(result._terminalReason),
      `unexpected terminal reason: ${result._terminalReason}`
    );
    assert.ok('_terminalReason' in result, 'returned object carries the field');
    assert.equal(result._terminalReason, 'provider_failure');
    assert.ok(
      result.content && result.content.trim().length > 0,
      'terminal carries visible content'
    );
    assert.doesNotMatch(result.content, /Fabricated success/);
    assert.equal(counter.calls, 1);
    assert.equal(conversation.messages.some(message => message.role === 'system'), false);
    assert.equal(loggedLoopEndedReason(entriesBefore), 'provider_failure');
  },
  { timeout: 20000 }
);
test('failed tool followed by success prose reports failure instead of displaying the claim', async () => {
  const originalExecute = toolRegistry.executeTool;
  toolRegistry.executeTool = async () => ({ result: { error: 'denied', denied: true } });
  try {
    const { promise, conversation, onToolResultLog } = startLoop(
      normalizeAIResponse(rawToolCall('call_denied', 'failing_tool', { justification: 'Modify record' })),
      [rawText('The record was updated successfully.')]
    );
    const result = await promise;
    assert.equal(result._terminalReason, 'tool_execution_failure');
    assert.doesNotMatch(result.content, /updated successfully/);
    assert.equal(onToolResultLog.some(message => /updated successfully/.test(message.content || '')), false);
    assert.equal(conversation.messages.some(message => /updated successfully/.test(message.content || '')), false);
  } finally {
    toolRegistry.executeTool = originalExecute;
  }
});
test('read-only tool does not satisfy an explicit mutation request', async () => {
  const counter = { calls: 0 };
  const conversation = createConversationManager();
  const messages = [];
  const result = await processToolCallLoop({
    initialResponse: normalizeAIResponse(rawToolCall('call_read_first', 'read_document', {})),
    conversationManager: conversation,
    aiClient: createAiClient([rawText('I changed the record.')], counter),
    getSystemPrompt: async () => 'test system prompt', tools: [], currentToolSupport: true,
    requestedActions: new Set(['update_document']),
    onToolResult: message => messages.push(message),
  });
  assert.equal(result._terminalReason, 'action_not_executed');
  assert.equal(messages.some(message => /changed the record/.test(message.content || '')), false);
  assert.equal(conversation.messages.some(message => /changed the record/.test(message.content || '')), false);
});
test('a successful action after a failed attempt can complete the turn', async () => {
  const originalExecute = toolRegistry.executeTool;
  let attempts = 0;
  toolRegistry.executeTool = async name => {
    if (name === 'failing_tool') {
      attempts++;
      return { result: attempts === 1 ? { error: 'stale read' } : { success: true, documentId: 'actor-1' } };
    }
    return originalExecute(name);
  };
  try {
    const conversation = createConversationManager();
    const result = await processToolCallLoop({
      initialResponse: normalizeAIResponse(rawToolCall('update_1', 'failing_tool', { justification: 'Update' })),
      conversationManager: conversation,
      aiClient: createAiClient([rawToolCall('update_2', 'failing_tool', { justification: 'Retry' }), rawText('The update succeeded.')], { calls: 0 }),
      getSystemPrompt: async () => 'test system prompt', tools: [], currentToolSupport: true,
      requestedActions: new Set(['failing_tool']),
    });
    assert.equal(attempts, 2);
    assert.equal(result._terminalReason, 'assistant_response');
    assert.equal(result.content, 'The update succeeded.');
  } finally {
    toolRegistry.executeTool = originalExecute;
  }
});
test(
  'repeat limit: failed tool executions exhaust the limit and value carries repeat_limit',
  async () => {
    const originalGet = globalThis.game.settings.get;
    const originalExecute = toolRegistry.executeTool;
    globalThis.game.settings.get = (scope, key) =>
      key === 'toolLoopLimit' ? 2 : originalGet(scope, key);
    toolRegistry.executeTool = async name =>
      name === 'failing_tool'
        ? { result: { error: 'simulated failure', toolName: name } }
        : originalExecute(name);
    try {
      const { promise, entriesBefore } = startLoop(
        normalizeAIResponse(rawToolCall('call_l1', 'failing_tool', {})),
        [rawToolCall('call_l2', 'failing_tool', {}), rawText('unused after limit')]
      );
      const result = await promise;

      assert.ok(result._toolLimitReachedError, 'limit flag set on returned value');
      assert.equal(result._terminalReason, 'repeat_limit');
      assert.equal(loggedLoopEndedReason(entriesBefore), 'repeat_limit');
    } finally {
      globalThis.game.settings.get = originalGet;
      toolRegistry.executeTool = originalExecute;
    }
  },
  { timeout: 20000 }
);

test('terminal reason coverage: exercised reasons are all in the known set', async () => {
  assert.ok(KNOWN_REASONS.length > 0);
  for (const reason of [
    'end_loop',
    'repeat_limit',
    'circuit_breaker',
    'provider_failure',
    'tool_call_failure',
    'tool_execution_failure',
    'parse_error',
    'cancelled',
  ]) {
    assert.ok(KNOWN_REASONS.includes(reason), `${reason} must be known`);
  }
});

test('step budget bounds valid tool calls and does not add an unmatched tool result', async () => {
  const originalGet = globalThis.game.settings.get;
  globalThis.game.settings.get = (scope, key) => key === 'toolLoopLimit' ? 2 : originalGet(scope, key);
  try {
    const { promise, counter, conversation } = startLoop(
      normalizeAIResponse(rawToolCall('step_1', 'list_documents', { justification: 'List' })),
      [rawToolCall('step_2', 'list_documents', { justification: 'List again' }), rawText('Never sent')]
    );
    const result = await promise;
    assert.equal(result._terminalReason, 'repeat_limit');
    assert.equal(counter.calls, 1);
    assert.deepEqual(conversation.messages.filter(message => message.role === 'tool').map(message => message.tool_call_id), ['step_1', 'step_2']);
  } finally {
    globalThis.game.settings.get = originalGet;
  }
});

test('old unlimited and oversized settings receive a finite budget', () => {
  assert.equal(getToolStepLimit(undefined), DEFAULT_TOOL_STEP_LIMIT);
  assert.equal(getToolStepLimit(0), DEFAULT_TOOL_STEP_LIMIT);
  assert.equal(getToolStepLimit(-1), DEFAULT_TOOL_STEP_LIMIT);
  assert.equal(getToolStepLimit(100), MAX_TOOL_STEP_LIMIT);
  assert.equal(getToolStepLimit(2), 2);
});

test('a saved zero limit no longer permits an unbounded tool loop', async () => {
  const originalGet = globalThis.game.settings.get;
  globalThis.game.settings.get = (scope, key) => key === 'toolLoopLimit' ? 0 : originalGet(scope, key);
  try {
    const { promise, counter } = startLoop(
      normalizeAIResponse(rawToolCall('initial', 'list_documents', { justification: 'List' })),
      [rawToolCall('again', 'list_documents', { justification: 'List' })]
    );
    const result = await promise;
    assert.equal(result._terminalReason, 'repeat_limit');
    assert.equal(counter.calls, DEFAULT_TOOL_STEP_LIMIT - 1);
  } finally {
    globalThis.game.settings.get = originalGet;
  }
});
