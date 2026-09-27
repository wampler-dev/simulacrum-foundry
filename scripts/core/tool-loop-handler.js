/* eslint-disable complexity, max-len, no-console */
// TODO: Refactor into modular helpers to resolve deep complexity debt (Tracked in #147)
/* eslint-disable max-lines */
/**
 * Simplified tool execution handler - pure tool execution logic
 * No conversation management - that's handled by ChatHandler
 */

import { createLogger, isDebugEnabled } from '../utils/logger.js';
import { toolRegistry } from './tool-registry.js';
import { COMPACTION_STATUS, MAX_COMPACTION_ROUNDS } from './conversation.js';
import {
  sanitizeMessagesForFallback,
  normalizeAIResponse,
  parseInlineToolCall,
  repairToolCallArguments,
} from '../utils/ai-normalization.js';
import { appendEmptyContentCorrection, appendToolFailureCorrection } from './correction.js';
import {
  isToolCallFailure,
  buildRetryLabel,
  getRetryDelayMs,
  delayWithSignal,
} from '../utils/retry-helpers.js';
import { emitProcessStatus, emitRetryStatus, SimulacrumHooks } from './hook-manager.js';
import { interactionLogger } from './interaction-logger.js';
import { executeToolCalls, storeToolJustification } from './tool-execution.js';
import { toolFailureMessage } from './turn-failure.js';
// Re-export for existing importers (chat-handler); the store lives in tool-execution.js.
export { retrieveToolJustification } from './tool-execution.js';

const logger = createLogger('ToolLoop');
const MAX_TOOL_FAILURE_ATTEMPTS = 3;
const TOOL_RETRY_STATUS_PREFIX = 'tool-retry';
export const DEFAULT_TOOL_STEP_LIMIT = 12;
export const MAX_TOOL_STEP_LIMIT = 20;

export function getToolStepLimit(configured) {
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, MAX_TOOL_STEP_LIMIT)
    : DEFAULT_TOOL_STEP_LIMIT;
}

/**
 * Execute tools from an AI response and continue autonomous loop
 */
export async function processToolCallLoop(options) {
  const callId = `tool-loop-${foundry.utils.randomID()}`;
  const loopId = callId;
  const context = { ...options, loopId };

  let terminalReason = 'unknown';

  try {
    emitProcessStatus('start', callId, { label: 'Thinking...', toolName: 'agentic-loop' });
    interactionLogger.logLoopEvent(loopId, 'loop_started', {
      initialToolCalls: options.initialResponse?.toolCalls?.length ?? 0,
    });

    const result = await _runLoopIteration(context);

    // Audit: every loop exit must carry an explicit terminal reason (#178).
    if (result?._terminalReason) {
      terminalReason = result._terminalReason;
    } else {
      logger.error('Loop exited without terminal reason', { loopId });
      terminalReason = 'unknown';
      if (result) result._terminalReason = 'unknown';
    }

    return result;
  } catch (error) {
    terminalReason = _classifyLoopError(error);
    throw error;
  } finally {
    interactionLogger.logLoopEvent(loopId, 'loop_ended', { reason: terminalReason });
    emitProcessStatus('end', callId, { reason: terminalReason });
  }
}

/**
 * Classify a loop error into a terminal reason string for timeline correlation.
 * @param {Error} error - The error thrown by the loop
 * @returns {string} 'cancelled', 'request_timeout', or 'error:<ErrorName>'
 */
function _classifyLoopError(error) {
  if (error?.name === 'AbortError' || /cancel/i.test(error?.message || '')) {
    return 'cancelled';
  }
  if (error?.name === 'NetworkError' && /timed out/i.test(error?.message || '')) {
    return 'request_timeout';
  }
  return `error:${error?.name || 'Error'}`;
}

// --- Internal Loop Logic ---

// eslint-disable-next-line max-lines-per-function -- Refactor tracked in #147
async function _runLoopIteration(context) {
  let currentResponse = context.initialResponse;

  const STEP_LIMIT = getToolStepLimit(game?.settings?.get('simulacrum', 'toolLoopLimit'));

  let stepCount = 0;
  let repeatCount = 0;
  let toolFailureAttempts = 0;

  let terminalReason = 'unknown';

  while (stepCount < STEP_LIMIT) {
    stepCount++;
    interactionLogger.logLoopEvent(context.loopId, 'loop_iteration_advanced', {
      stepCount,
    });

    if (context.signal?.aborted) throw new Error('Process was cancelled');

    // Never display unverified success prose after a failed tool result.
    if ((context.lastToolFailed || (context.requestedActions?.size && !context.actionCompleted)) &&
        !currentResponse._parseError &&
        !isToolCallFailure(currentResponse) &&
        (!Array.isArray(currentResponse.toolCalls) || currentResponse.toolCalls.length === 0) &&
        currentResponse.content?.trim()) {
      currentResponse = toolFailureMessage(context.lastToolFailed ? 'tool_execution_failure' : 'action_not_executed');
    }

    // Extract response from tool calls (primary) or use content (fallback)
    // The response parameter is the canonical way for AI to communicate with users
    const toolResponse = _extractToolResponse(currentResponse.toolCalls);
    if (toolResponse) {
      currentResponse.content = toolResponse;
    }
    if (currentResponse.toolCalls?.every(call => (call.function?.name || call.name) === 'end_loop') &&
        (context.lastToolFailed || (context.requestedActions?.size && !context.actionCompleted))) {
      currentResponse.content = toolFailureMessage(context.lastToolFailed ? 'tool_execution_failure' : 'action_not_executed').content;
    }

    // Notify UI of the message content FIRST so pending cards have a message to attach to
    // We must ensure an assistant message bubble exists even if content is empty (pure tool call)
    // otherwise the pending tool card will attach to the *previous* assistant message (floating bug).
    const hasContent = currentResponse.content && currentResponse.content.trim().length > 0;
    const hasTools =
      Array.isArray(currentResponse.toolCalls) && currentResponse.toolCalls.length > 0;

    if (hasContent || hasTools) {
      await _notifyAssistantMessage(currentResponse, context);
    }

    // Emit pending tool state for each tool call AFTER assistant message exists
    // (UI appends pending cards to last assistant message)
    if (Array.isArray(currentResponse.toolCalls) && currentResponse.toolCalls.length > 0) {
      for (const toolCall of currentResponse.toolCalls) {
        const toolName = toolCall.function?.name || toolCall.name || 'Unknown Tool';
        const toolCallId =
          toolCall.id || `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        let justification = '';

        try {
          const args = toolCall.function?.arguments || toolCall.arguments;
          const parsed = typeof args === 'string' ? JSON.parse(args) : args;
          if (parsed && parsed.justification) {
            justification = parsed.justification;
          }
        } catch (_e) {
          // Ignore parsing errors
        }

        // Store justification for retrieval when result is ready
        storeToolJustification(toolCallId, justification);

        // Emit pending tool state via callback (Closed Loop)
        if (context.onToolPending) {
          context.onToolPending({
            toolCallId,
            toolName,
            justification,
          });
        }

        // Emit hook for UI to render pending tool card (Backwards Compatibility / Observability)
        Hooks.callAll('simulacrumToolPending', {
          toolCallId,
          toolName,
          justification,
        });
      }
    }

    // Process a single cycle of the loop
    const cycleResult = await _processLoopCycle(currentResponse, context, {
      toolFailureAttempts,
      repeatCount,
      STEP_LIMIT,
      atLimit: stepCount >= STEP_LIMIT,
    });

    // Handle cycle outcome
    if (cycleResult.action === 'return') {
      cycleResult.value._terminalReason = cycleResult.reason || 'unknown';
      return cycleResult.value;
    }
    if (cycleResult.action === 'break') {
      terminalReason = cycleResult.reason || 'unknown';
      break;
    }

    // Update state for next iteration
    currentResponse = cycleResult.response;
    repeatCount = cycleResult.repeatCount;
    toolFailureAttempts = cycleResult.toolFailureAttempts;
  }

  // Handle Repeat Limit if loop finished naturally without break
  if (stepCount >= STEP_LIMIT || terminalReason === 'repeat_limit') {
    const value = _handleRepeatLimit(stepCount, STEP_LIMIT);
    value._terminalReason = 'repeat_limit';
    return value;
  }

  // NOTE: We do NOT need to call _notifyAssistantMessage here.
  // The content was already notified at the start of the final iteration (Line 50)
  // or will be handled by the caller. Invoking it here causes duplicates.

  currentResponse._terminalReason = terminalReason;
  return currentResponse;
}

// eslint-disable-next-line max-lines-per-function -- Refactor tracked in #147
async function _processLoopCycle(currentResponse, context, state) {
  let { toolFailureAttempts, repeatCount } = state; // eslint-disable-line prefer-const
  const { STEP_LIMIT, atLimit } = state;

  // 1. Handle Parse Errors
  if (currentResponse._parseError) {
    if (atLimit) return { action: 'break', reason: 'repeat_limit' };
    repeatCount++;
    const response = await _handleParseError(currentResponse, context, repeatCount, STEP_LIMIT);
    return { action: 'continue', response, repeatCount, toolFailureAttempts };
  }

  // 2. Handle Tool Call Failures
  if (isToolCallFailure(currentResponse)) {
    toolFailureAttempts++;
    if (toolFailureAttempts >= MAX_TOOL_FAILURE_ATTEMPTS) {
      return { action: 'return', value: toolFailureMessage('tool_call_failure'), reason: 'tool_call_failure' };
    }
    if (atLimit) return { action: 'break', reason: 'repeat_limit' };
    const response = await _handleToolRefusal(currentResponse, context, toolFailureAttempts);
    return { action: 'continue', response, repeatCount, toolFailureAttempts };
  }

  // 3. A substantive assistant answer completes the turn, with or without prior tools.
  if (!Array.isArray(currentResponse.toolCalls) || currentResponse.toolCalls.length === 0) {
    if (currentResponse.content && currentResponse.content.trim().length > 0) {
      if (context.lastToolFailed || currentResponse._terminalReason === 'action_not_executed') {
        context.conversationManager.addMessage('assistant', currentResponse.content);
        await context.conversationManager.save();
        _finishTaskTracker();
        return { action: 'return', value: currentResponse, reason: currentResponse._terminalReason };
      }
      context.conversationManager.addMessage('assistant', currentResponse.content);
      await context.conversationManager.save();
      _finishTaskTracker();
      return { action: 'return', value: currentResponse, reason: 'assistant_response' };
    }
    repeatCount++;
    if (atLimit) return { action: 'break', reason: 'repeat_limit' };
    appendEmptyContentCorrection(context.conversationManager, currentResponse);
    interactionLogger.logLoopEvent(context.loopId, 'continuation_requested', {
      reason: 'empty_response_correction',
    });
    const response = await _getNextAIResponse([], context);
    return { action: 'continue', response, repeatCount, toolFailureAttempts };
  }

  // 3.5 FIX: Add assistant message with tool_calls to conversation BEFORE executing tools
  // This ensures the tool result messages have a matching parent assistant message with IDs
  // Required by Mistral and other strict APIs for tool_call_id validation
  const addedToolCallsToConversation =
    context.currentToolSupport === true && currentResponse.toolCalls.length > 0;
  if (addedToolCallsToConversation) {
    const content = currentResponse.content || null;
    const metadata = currentResponse.provider_metadata || null;
    // Strip transient UI-only fields (justification, response) from stored tool_calls
    // to reduce token accumulation in conversation history. These fields are already
    // consumed for display before this point (justification for pending cards, response
    // for message content). Original toolCalls are preserved for executeToolCalls below.
    const sanitizedToolCalls = _sanitizeToolCallsForHistory(currentResponse.toolCalls);
    context.conversationManager.addMessage(
      'assistant',
      content,
      sanitizedToolCalls,
      null,
      metadata
    );
    await context.conversationManager.save();
  }

  // 4. Execute Tools - wrapped in try/catch to handle abort and maintain message parity
  let toolResults;
  try {
    toolResults = await executeToolCalls(currentResponse.toolCalls, context);
  } catch (execError) {
    // If execution was aborted/cancelled after we added the assistant message with tool_calls,
    // we MUST add stub tool responses for ALL tool calls to maintain message parity.
    // Otherwise Mistral (and other strict APIs) will error with:
    // "Not the same number of function calls and responses"
    if (addedToolCallsToConversation && execError.message?.includes('cancelled')) {
      logger.warn('Process cancelled mid-execution; adding cancellation responses for tool calls');
      const cancelledResult = {
        error: 'Process was cancelled by user',
        cancelled: true,
      };
      for (const toolCall of currentResponse.toolCalls) {
        // Check if a response was already added for this tool call
        const messages =
          context.conversationManager.getMessages?.() ?? context.conversationManager.messages ?? [];
        const hasResponse = messages.some(m => m.role === 'tool' && m.tool_call_id === toolCall.id);
        if (!hasResponse) {
          context.conversationManager.addMessage(
            'tool',
            JSON.stringify(cancelledResult),
            null,
            toolCall.id
          );
        }
      }
      await context.conversationManager.save();
    }
    // Re-throw to be handled by caller
    throw execError;
  }

  interactionLogger.logLoopEvent(context.loopId, 'tool_results_committed', {
    committed: toolResults.length,
    successful: toolResults.filter(r => r.success).length,
    toolNames: toolResults.map(r => r.toolName),
  });
  const precedingToolFailed = context.lastToolFailed;
  context.lastToolFailed = toolResults.some(result => !result.success);
  if (toolResults.some(result => result.success && context.requestedActions?.has(result.toolName))) {
    context.actionCompleted = true;
  }

  // 5. Handle Execution Failures
  if (toolResults.some(r => !r.success)) {
    repeatCount++;
    _logToolFailures(toolResults, repeatCount, STEP_LIMIT);
  }

  // 5.5 Check for end_loop tool - terminate the loop
  const endLoopResult = toolResults.find(
    r => r.result?._endLoop === true || r.result?.data?._endLoop === true
  );
  if (endLoopResult) {
    if (isDebugEnabled()) logger.debug('end_loop tool detected; terminating loop');

    // Auto-close task tracker if manage_task has an active task
    _finishTaskTracker();

    if (precedingToolFailed || (context.requestedActions?.size && !context.actionCompleted)) {
      const reason = precedingToolFailed ? 'tool_execution_failure' : 'action_not_executed';
      const value = toolFailureMessage(reason);
      value._emitted = currentResponse._emitted;
      return { action: 'return', value, reason };
    }
    return { action: 'break', reason: 'end_loop' };
  }

  // 6. Legacy Mode Notification
  if (context.currentToolSupport !== true && toolResults.length > 0) {
    _notifyLegacyToolResults(toolResults, context);
  }

  if (atLimit) return { action: 'break', reason: 'repeat_limit' };

  // 7. The AI client owns transport retries; do not multiply attempts here.
  interactionLogger.logLoopEvent(context.loopId, 'continuation_requested', {
    reason: 'after_tool_results',
    toolResults: toolResults.length,
  });
  try {
    const response = await _getNextAIResponse(toolResults, context);
    return { action: 'continue', response, repeatCount, toolFailureAttempts };
  } catch (error) {
    if (_classifyLoopError(error) === 'cancelled' || _classifyLoopError(error) === 'request_timeout') throw error;
    logger.error('AI continuation failed after provider retries:', error);
    return { action: 'return', value: toolFailureMessage('provider_failure'), reason: 'provider_failure' };
  }
}

function _finishTaskTracker() {
  const manageTaskTool = toolRegistry.getTool('manage_task');
  if (manageTaskTool?.currentTask) {
    Hooks.callAll(SimulacrumHooks.TASK_FINISHED);
    manageTaskTool.currentTask = null;
  }
}

// --- Helper Functions ---

async function _handleParseError(response, context, repeatCount, limit) {
  if (isDebugEnabled()) {
    logger.info(`AI response parse error (retry ${repeatCount}/${limit})`, {
      content: response.content,
    });
  }
  appendEmptyContentCorrection(context.conversationManager, response);
  const messages = _getConversationMessages(context);
  const systemPrompt = await context.getSystemPrompt();
  return _chatWithAI(messages, systemPrompt, context);
}

async function _handleToolRefusal(response, context, attempts) {
  appendToolFailureCorrection(context.conversationManager, response);
  const nextAttempt = attempts + 1;
  const retryCallId = `${TOOL_RETRY_STATUS_PREFIX}-${Date.now()}-${nextAttempt}`;
  const label = buildRetryLabel(nextAttempt, MAX_TOOL_FAILURE_ATTEMPTS);
  const delayMs = getRetryDelayMs(attempts - 1);

  emitRetryStatus('start', retryCallId, label);
  try {
    if (delayMs) await delayWithSignal(delayMs, context.signal);
    const messages = _getConversationMessages(context);
    const systemPrompt = await context.getSystemPrompt();
    return await _chatWithAI(messages, systemPrompt, context);
  } finally {
    emitRetryStatus('end', retryCallId);
  }
}

// eslint-disable-next-line no-unused-vars
async function _getNextAIResponse(toolResults, context) {
  const { getSystemPrompt, conversationManager, aiClient } = context;

  let systemPrompt = await getSystemPrompt();

  // Context Compaction: account for system prompt overhead and loop until within budget
  if (conversationManager && aiClient) {
    try {
      let rounds = 0;
      let promptOverhead = conversationManager.estimatePromptOverhead(systemPrompt);

      while (rounds < MAX_COMPACTION_ROUNDS) {
        const compactionStatus = await conversationManager.compactHistory(
          aiClient,
          promptOverhead,
          context.signal
        );
        rounds++;
        interactionLogger.logLoopEvent(context.loopId, 'compaction_round', {
          round: rounds,
          status: compactionStatus,
        });
        if (compactionStatus === COMPACTION_STATUS.WITHIN_BUDGET) break;
        if (compactionStatus === COMPACTION_STATUS.FAILED) break;

        if (isDebugEnabled()) logger.debug('Conversation history compacted during tool loop');
        systemPrompt = await getSystemPrompt();
        promptOverhead = conversationManager.estimatePromptOverhead(systemPrompt);
      }
    } catch (err) {
      logger.warn('Compaction failed during tool loop:', err);
    }
  }

  const messages = _getConversationMessages(context);
  return _chatWithAI(messages, systemPrompt, context);
}

// --- Utilities ---

/**
 * Strip transient fields from tool_calls before storing in conversation history.
 * justification and response are consumed for UI display before storage and
 * don't need to persist in context sent to the API on subsequent calls.
 * @param {Array} toolCalls - Original tool calls array
 * @returns {Array} New array with transient fields removed from arguments
 */
function _sanitizeToolCallsForHistory(toolCalls) {
  const TRANSIENT_FIELDS = ['response'];

  return toolCalls.map(tc => {
    // Access arguments from either location (standard or legacy)
    const argsRaw = tc.function?.arguments ?? tc.arguments;

    // Ensure stored history always has valid-JSON arguments. If the model
    // emitted a malformed string that slipped through normalization, replace
    // it with a sentinel payload so replaying the conversation does not
    // trigger provider-side parse 500s.
    const outcome = repairToolCallArguments(argsRaw);
    let parsed;
    if (outcome.ok) {
      parsed = outcome.argsObject;
    } else {
      parsed = {
        __simulacrumParseError: true,
        parseError: outcome.parseError,
        rawFragment:
          typeof argsRaw === 'string' ? argsRaw.slice(0, 500) : String(argsRaw).slice(0, 500),
      };
    }

    // Treat non-string args as a change to force re-serialization (ensures string storage)
    let changed = !outcome.ok || outcome.repaired || typeof argsRaw !== 'string';

    // Strip transient fields if result is an object.
    // Create a shallow copy if it is an object to avoid mutating the original tool call.
    if (parsed && typeof parsed === 'object') {
      let workingParsed = parsed;
      let hasTransientField = false;
      for (const field of TRANSIENT_FIELDS) {
        if (field in parsed) {
          hasTransientField = true;
          break;
        }
      }

      if (hasTransientField) {
        workingParsed = { ...parsed };
        for (const field of TRANSIENT_FIELDS) {
          delete workingParsed[field];
        }
        changed = true;
      }
      parsed = workingParsed;
    }

    if (!changed) return tc;

    const cleanArgs = JSON.stringify(parsed);

    if (tc.function) {
      return { ...tc, function: { ...tc.function, arguments: cleanArgs } };
    }
    return { ...tc, arguments: cleanArgs };
  });
}

function _getConversationMessages(context) {
  return context.conversationManager.getMessages?.() ?? context.conversationManager.messages ?? [];
}

async function _chatWithAI(messages, systemPrompt, context) {
  const { aiClient, tools, currentToolSupport, signal } = context;
  const toolsToSend = currentToolSupport === true ? tools : null;

  // We already have messages.
  // But original `getNextAIResponse` constructed `messagesToSend` manually for native mode?
  // "For native mode, build messages without system (will be added by chatWithSystem)"
  // And "Add tool results to conversation context for native mode only".
  // Wait, didn't `conversationManager.addMessage('tool')` already do that?
  // Yes, line 325 in original code.
  // `getNextAIResponse` lines 415-425 duplicated that logic?
  // "Add tool results to conversation context for native mode only"
  // `const messagesToSend = [...conversationMessages];`
  // `messagesToSend.push({ ... })`.
  // If `conversationManager` already has them, this DOUBLES them!
  // UNLESS `conversationManager.addMessage` doesn't persist to `messages` array immediately?
  // `conversationManager` is usually stateful.
  // I suspect original code had a bug of duplication OR `conversationManager` is not stateful in that way?
  // Actually, `conversationManager.addMessage` pushes to `this.messages`.
  // So `conversationMessages` (got from `getMessages()`) HAS them.
  // So `getNextAIResponse` adding them AGAIN to `messagesToSend` is suspicious.
  // Ah, wait. `conversationManager` usage in `processToolCallLoop` vs `executeToolCalls`.
  // In `executeToolCalls`: `conversationManager.addMessage` is called.
  // In `getNextAIResponse`: `const conversationMessages = conversationManager.getMessages...`
  // So `conversationMessages` *includes* the tool outputs.
  // Then `getNextAIResponse` iterates `toolResults` and PUSHES THEM AGAIN?
  // Complexity 47 might hide bugs.

  // I will assume `conversationManager` handles state.
  // I will use `messages` from manager.

  // Sanitize for fallback
  const sysMsg = { role: 'system', content: systemPrompt };
  const fallbackMsgs = sanitizeMessagesForFallback([sysMsg, ...messages]);

  interactionLogger.logLoopEvent(context.loopId, 'api_request_started', {
    mode: currentToolSupport === true ? 'native' : 'fallback',
  });
  const startedAt = Date.now();

  let raw;
  try {
    raw =
      currentToolSupport !== true
        ? await aiClient.chat(fallbackMsgs, toolsToSend, { signal })
        : await aiClient.chatWithSystem(messages, () => systemPrompt, toolsToSend, { signal });
  } catch (error) {
    if (_classifyLoopError(error) === 'cancelled') {
      interactionLogger.logLoopEvent(context.loopId, 'api_request_aborted');
    } else {
      interactionLogger.logLoopEvent(context.loopId, 'api_request_failed', {
        error: error.message,
      });
    }
    throw error;
  }

  interactionLogger.logLoopEvent(context.loopId, 'api_request_finished', {
    ms: Date.now() - startedAt,
  });

  const normalized = normalizeAIResponse(raw);

  // Legacy fallback tool parsing
  if (
    context.currentToolSupport !== true &&
    (!normalized.toolCalls || !normalized.toolCalls.length)
  ) {
    const parsed = parseInlineToolCall?.(normalized.content);
    if (parsed && parsed.name) {
      normalized.toolCalls = [
        {
          id: 'fallback_' + Date.now(),
          function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments || {}) },
        },
      ];
    }
  }
  return normalized;
}

/**
 * Extract the response parameter from tool calls
 * The response parameter is the canonical way for AI to communicate with users
 * @param {Array} toolCalls - Array of tool calls from the AI response
 * @returns {string|null} The combined response text or null if none found
 */
function _extractToolResponse(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return null;
  }

  // Collect responses from all tool calls that have them
  const responses = toolCalls
    .map(tc => {
      // Arguments may be a JSON string or already parsed object
      const args = tc.function?.arguments || tc.arguments;
      if (!args) return null;

      try {
        const parsed = typeof args === 'string' ? JSON.parse(args) : args;
        return parsed?.response;
      } catch (_e) {
        return null;
      }
    })
    .filter(r => r && typeof r === 'string' && r.trim().length > 0);

  if (responses.length === 0) {
    return null;
  }

  // Join multiple responses with newlines
  return responses.join('\n\n');
}

async function _notifyAssistantMessage(response, context) {
  if (context.onToolResult && !response._parseError) {
    // Deduplicate identical content within the same loop to prevent UI spam
    const content = response.content?.trim() || ''; // Use empty string if undefined

    // We emit if content is new OR if it's the first emission (even if empty) to serve as tool anchor
    if (content !== context.lastEmittedContent || !response._emitted) {
      // Pass content (even if empty) to UI. SidebarEventHandlers/ChatHandler must handle empty accordingly.
      await context.onToolResult({
        role: 'assistant',
        content: response.content || undefined,
        _fromToolLoop: true,
      });
      interactionLogger.logLoopEvent(context.loopId, 'assistant_emitted', {
        hasContent: Boolean(content),
      });
      context.lastEmittedContent = content;
    }
    // Flag as emitted to prevent duplication in ConversationEngine
    response._emitted = true;
  }
}

function _notifyLegacyToolResults(toolResults, context) {
  const latest = toolResults[toolResults.length - 1];
  const msg = latest.success
    ? `Tool execution completed: ${latest.toolName} executed successfully. Result: ${JSON.stringify(latest.result)}`
    : `Tool execution failed: ${latest.toolName} failed.`;
  context.conversationManager.addMessage('system', msg);
}

function _logToolFailures(toolResults, retryCount, limit) {
  if (isDebugEnabled()) {
    logger.info(`Tool execution failures (retry ${retryCount}/${limit})`, {
      failedCount: toolResults.filter(r => !r.success).length,
    });
  }
}

function _handleRepeatLimit(count, limit) {
  // Log error (use logger not console)
  logger.warn(`Tool step limit reached after ${limit} steps`, { count });
  return {
    content: '',
    display: null,
    _toolLimitReachedError: true,
    toolCalls: [],
    endTask: true,
  };
}
