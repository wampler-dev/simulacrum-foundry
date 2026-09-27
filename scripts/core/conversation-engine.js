/* eslint-disable complexity, max-lines-per-function, no-unused-vars */
/**
 * ConversationEngine — Orchestrator for a single user turn.
 * Centralizes message assembly, correction enforcement, tool-loop invocation,
 * and retries, while preserving existing public behavior.
 */

import { SimulacrumCore } from './simulacrum-core.js';
import { processToolCallLoop } from './tool-loop-handler.js';
import { toolRegistry } from './tool-registry.js';
import { ACTION_TOOL_NAMES, getTurnToolSchemas } from './turn-capabilities.js';
import { toolFailureMessage } from './turn-failure.js';
import { appendEmptyContentCorrection, appendToolFailureCorrection } from './correction.js';
import {
  isToolCallFailure,
  emitProcessStatus,
  buildRetryLabel,
  getRetryDelayMs,
  delayWithSignal,
  buildGenericFailureMessage,
} from '../utils/retry-helpers.js';

const MAX_PRE_TOOL_ATTEMPTS = 3;
const RETRY_STATUS_CALL_PREFIX = 'tool-retry';

class ConversationEngine {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Process a user turn. Assumes the caller already added the user message
   * to the conversation.
   * @param {object} options
   * @param {AbortSignal} [options.signal]
   * @param {function} [options.onAssistantMessage]
   * @param {function} [options.onToolResult]
   * @returns {Promise<object>} final assistant response
   */
  async processTurn(options = {}) {
    const { signal, onAssistantMessage, onToolResult } = options;
    const { allowed, schemas: tools } = getTurnToolSchemas(this.conversationManager.getMessages(), toolRegistry);
    const requestedActions = new Set([...allowed].filter(name => ACTION_TOOL_NAMES.has(name)));

    // Get initial assistant response
    let aiResponse = await SimulacrumCore.generateResponse(this.conversationManager.getMessages(), {
      signal,
      onAssistantMessage,
      tools,
    });

    // Pre-tool correction loop (bounded) - handles parse errors and tool call failures
    let attempt = 1;
    while (
      aiResponse &&
      (aiResponse._parseError || isToolCallFailure(aiResponse)) &&
      attempt < MAX_PRE_TOOL_ATTEMPTS
    ) {
      if (aiResponse._parseError) {
        appendEmptyContentCorrection(this.conversationManager, aiResponse);
      } else {
        appendToolFailureCorrection(this.conversationManager, aiResponse);
      }

      const nextAttempt = attempt + 1;
      const delayMs = getRetryDelayMs(attempt - 1);
      const callId = `${RETRY_STATUS_CALL_PREFIX}-${Date.now()}-${nextAttempt}`;
      const label = buildRetryLabel(nextAttempt, MAX_PRE_TOOL_ATTEMPTS);

      emitProcessStatus('start', callId, { label });
      try {
        if (delayMs) {
          await delayWithSignal(delayMs, signal);
        }
        aiResponse = await SimulacrumCore.generateResponse(this.conversationManager.getMessages(), {
          signal,
          tools,
        });
      } finally {
        emitProcessStatus('end', callId);
      }

      attempt = nextAttempt;
    }

    // If parse error persists after retries, return failure message
    if (aiResponse && aiResponse._parseError) {
      const errorMessage = buildGenericFailureMessage();
      if (onAssistantMessage) await onAssistantMessage(errorMessage);
      return errorMessage;
    }

    // A failed invocation cannot be turned into verified work by a prose fallback.
    if (aiResponse && isToolCallFailure(aiResponse)) {
      const failure = toolFailureMessage('tool_call_failure');
      this.conversationManager.addMessage('assistant', failure.content);
      if (onAssistantMessage) await onAssistantMessage({ ...failure, _fromToolLoop: true });
      return failure;
    }

    // If no tools, emit assistant and finish
    if (!Array.isArray(aiResponse.toolCalls) || aiResponse.toolCalls.length === 0) {
      if (requestedActions.size) {
        const failure = toolFailureMessage('action_not_executed');
        this.conversationManager.addMessage('assistant', failure.content);
        if (onAssistantMessage) await onAssistantMessage({ ...failure, _fromToolLoop: true });
        return failure;
      }
      if (onAssistantMessage && aiResponse?.content) {
        await onAssistantMessage({
          role: 'assistant',
          content: aiResponse.content,
          display: aiResponse.display || aiResponse.content,
        });
      }
      return aiResponse;
    }

    // With tools: delegate to tool loop (let the loop emit assistant/tool updates)
    // Note: tool-loop-handler now handles adding assistant messages with tool_calls
    const legacyMode = game?.settings?.get('simulacrum', 'legacyMode') ?? false;
    const currentToolSupport = !legacyMode;

    const finalResponse = await processToolCallLoop({
      initialResponse: aiResponse,
      tools,
      allowedToolNames: allowed,
      requestedActions,
      conversationManager: this.conversationManager,
      aiClient: SimulacrumCore.aiClient,
      getSystemPrompt: SimulacrumCore.getSystemPrompt.bind(SimulacrumCore),
      currentToolSupport,
      signal,
      onToolResult: onToolResult || null,
    });

    // Surface the repeat-limit terminal so the loop never ends silently (#178)
    if (finalResponse?._toolLimitReachedError) {
      const limitMessage = {
        role: 'assistant',
        content:
          'Tool execution limit reached. The autonomous loop stopped at the configured iteration limit.',
        display:
          '⚠️ **Tool execution limit reached**\n\nSend another message to continue the task.',
        _fromToolLoop: true,
        _terminalReason: finalResponse._terminalReason || 'repeat_limit',
      };
      this.conversationManager.addMessage('assistant', limitMessage.content);
      if (onAssistantMessage) {
        await onAssistantMessage(limitMessage);
      }
      return limitMessage;
    }
    // If loop produced a distinct final message and it wasn't already emitted by the loop handler, emit to UI
    if (finalResponse && ['provider_failure', 'tool_call_failure'].includes(finalResponse._terminalReason)) {
      this.conversationManager.addMessage('assistant', finalResponse.content);
      await this.conversationManager.save();
    }
    if (finalResponse && finalResponse.content && onAssistantMessage && !finalResponse._emitted) {
      await onAssistantMessage({
        role: 'assistant',
        content: finalResponse.content,
        display: finalResponse.display || finalResponse.content,
        _fromToolLoop: true, // Signal that this was already added to conversation by tool-loop-handler
      });
    }

    return finalResponse;
  }

}

export { ConversationEngine };
