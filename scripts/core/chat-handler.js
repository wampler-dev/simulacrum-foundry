/* eslint-disable max-depth */
import { createLogger } from '../utils/logger.js';
import {
  formatToolCallDisplay,
  getToolDisplayContent,
  getToolContentSummary,
} from '../utils/message-utils.js';
import { MarkdownRenderer } from '../lib/markdown-renderer.js';
import { retrieveToolJustification } from './tool-loop-handler.js';
/**
 * ChatHandler - sidebar-facing adapter for ConversationEngine and tool results.
 */

class ChatHandler {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
    this.logger = createLogger('ChatHandler');
  }

  /**
   * Main entry point for processing user messages
   * Handles the complete flow: user input -> AI -> tools -> UI
   */
  async processUserMessage(message, user, options = {}) {
    let cancellationRecorded = false;
    const recordCancellation = () => {
      if (cancellationRecorded) return;
      cancellationRecorded = true;
      if (this.conversationManager.closeCancelledTurn) {
        this.conversationManager.closeCancelledTurn();
      } else {
        this.addMessageToConversation('assistant', 'Process cancelled by user');
      }
    };
    try {
      if (options.signal?.aborted) return;
      // Add user message to conversation state
      this.addMessageToConversation('user', message);
      options.signal?.addEventListener('abort', recordCancellation, { once: true });

      // Notify UI if callback provided
      if (options.onUserMessage) {
        options.onUserMessage({ role: 'user', content: message, user });
      }

      // Delegate orchestration to ConversationEngine
      const { ConversationEngine } = await import('./conversation-engine.js');
      const engine = new ConversationEngine(this.conversationManager);

      const finalResponse = await engine.processTurn({
        signal: options.signal,
        onAssistantMessage: async msg => {
          if (options.signal?.aborted) return;
          // Support ephemeral messages (display only) by checking for either content or display
          if (msg?.role === 'assistant' && (msg?.content || msg?.display)) {
            // Only add to conversation if this is NOT a tool-call response.
            // Messages with tool calls are already added by tool-loop-handler before execution.
            // Adding here would cause duplicate log entries.
            if (msg.content && !msg.toolCalls && !msg._fromToolLoop) {
              this.addMessageToConversation('assistant', msg.content);
            }
            await this.addMessageToUI(
              { role: 'assistant', content: msg.content, display: msg.display || msg.content },
              options
            );
          }
        },
        onToolResult: async toolResult => await this.handleToolResult(toolResult, options),
      });

      if (options.signal?.aborted) {
        throw Object.assign(new Error('Process was cancelled'), { name: 'AbortError' });
      }

      return finalResponse;
    } catch (error) {
      // Handle cancellation — not an error, just user-initiated stop
      if (error.name === 'AbortError' || error.message === 'Process was cancelled') {
        this.logger.info('Process cancelled by user');
        const cancelMessage = {
          role: 'assistant',
          content: 'Process cancelled by user',
          display: '🛑 Process cancelled',
          noGroup: true,
        };
        // A signal listener closes the turn at Stop time, even if a tool settles later.
        recordCancellation();
        await this.conversationManager.save();
        await this.addMessageToUI(cancelMessage, options);
        return cancelMessage;
      }

      this.logger.error('Error processing user message', error);

      // Invoke onError callback to restore user's message to input field
      // This is for ACTUAL errors (not cancellation) where we want to allow retry
      if (options.onError) {
        options.onError({ originalMessage: message, error });
      }

      // Check for 503 Service Unavailable or other API connection issues
      let friendlyMessage = `Error: ${error.message}`;
      let displayMessage = `${error.message}`;

      if (error.message.includes('503') || error.message.includes('Service Unavailable')) {
        friendlyMessage =
          'The AI service is currently unavailable (503). This is typically a temporary issue with the AI provider. Please try again in a few moments.';
        displayMessage = `⚠️ **AI Service Unavailable**\n\nThe AI endpoint is experiencing issues (503). This is usually temporary.\n\n*Error details: ${error.message}*`;
      } else if (
        error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError')
      ) {
        friendlyMessage =
          'Network connection failed. Please check your internet connection and API settings.';
        displayMessage = `**Network Error**\n\nFailed to connect to the AI service.\n\n*Error details: ${error.message}*`;
      }

      // API/Network errors: Show via FoundryVTT notification system
      if (globalThis.ui?.notifications?.error) {
        ui.notifications.error(`Simulacrum: ${error.message}`, { permanent: false });
      } else {
        this.logger.error(`Simulacrum Error: ${error.message}`);
      }

      // CRITICAL: fallback response for the chat UI
      const errorMessage = {
        role: 'assistant',
        content: friendlyMessage,
        display: displayMessage,
        error,
      };

      // Ensure the error is displayed in the chat interface
      this.addMessageToUI(errorMessage, options);

      return errorMessage;
    } finally {
      options.signal?.removeEventListener('abort', recordCancellation);
    }
  }

  /**
   * Handle individual tool results during execution
   * Task-09: Enhanced to format tool results with status icons
   */
  async handleToolResult(toolResult, options = {}) {
    // Add tool result to conversation
    if (toolResult.role === 'tool') {
      // FIX: Do not add to conversation here, as tool-loop-handler already adds it internally.
      // this.addMessageToConversation('tool', toolResult.content, null, toolResult.toolCallId);

      // Check for silent/hidden tools - skip UI rendering
      const hiddenTools = ['end_loop'];
      // Tools that don't need justification displayed (self-explanatory from context)
      const noJustificationTools = ['read_tool_output'];
      // Tools that render their display directly without tool card wrapper
      const directDisplayTools = ['manage_task'];
      let isSilent = hiddenTools.includes(toolResult.toolName);
      if (!isSilent) {
        try {
          const parsed =
            typeof toolResult.content === 'string'
              ? JSON.parse(toolResult.content)
              : toolResult.content;
          isSilent = parsed?._silent === true;
        } catch (_e) {
          /* not JSON, not silent */
        }
      }

      // Task-09: Format tool result with rich HTML display if it has a toolName (and is not silent)
      if (toolResult.toolName && options.onAssistantMessage && !isSilent) {
        // Direct display tools: render their display property directly without tool card wrapper
        if (directDisplayTools.includes(toolResult.toolName)) {
          const payload = {
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName,
          };

          // Prefer direct callback for removal
          if (options.onToolRemove) {
            options.onToolRemove(payload);
          }

          // Emit hook (standard event for pending removal? or result?)
          // Maintained for backward compatibility, but arguably this should be simulacrumToolRemove?
          // Existing listeners likely expect 'simulacrumToolResult' to imply completion.
          Hooks.callAll('simulacrumToolResult', payload);

          const rawDisplay = getToolDisplayContent(toolResult);
          // Only show if there's actual display content (skip empty displays like start_task)
          if (rawDisplay && rawDisplay.trim()) {
            // Check if display is already HTML (starts with <) or needs markdown rendering
            let formattedDisplay = rawDisplay;
            if (!rawDisplay.trim().startsWith('<')) {
              formattedDisplay = await MarkdownRenderer.render(rawDisplay, { force: true });
            }
            // Extract proper content summary (not raw JSON)
            const contentSummary = getToolContentSummary(toolResult) || '';
            await this.addMessageToUI(
              {
                role: 'assistant',
                content: contentSummary,
                display: formattedDisplay,
                _fromToolLoop: true, // Prevent duplicate conversation entry
              },
              options
            );
          }
          return; // Skip standard tool card formatting
        }

        // Retrieve justification stored during pending phase (skip for self-explanatory tools)
        const justification = noJustificationTools.includes(toolResult.toolName)
          ? ''
          : retrieveToolJustification(toolResult.toolCallId);

        let preRendered = null;
        try {
          // Task-Fix: Unwrap content if it's JSON to prevent leaking raw JSON string.
          // Prioritize 'display' property using shared utility.
          // CRITICAL: Always render valid Markdown, even if 'display' property is used, as tools return Markdown.
          // Use force: true to ensure mixed HTML/Markdown (like @UUID which might look like tags?) is processed.
          const rawDisplay = getToolDisplayContent(toolResult);
          if (rawDisplay) {
            preRendered = await MarkdownRenderer.render(rawDisplay, { force: true });
          } else {
            // Fallback: Check if content is JSON. If so, SKIP rendering and let formatToolCallDisplay handle it
            // (it has smarter logic for extracting display/message/error from JSON).
            // If NOT JSON (e.g. legacy string output), render it as markdown.
            const content = toolResult.content;
            let isJson = false;
            if (typeof content === 'string' && content.trim().startsWith('{')) {
              try {
                JSON.parse(content);
                isJson = true;
              } catch (e) {}
            }

            if (!isJson) {
              preRendered = await MarkdownRenderer.render(content);
            }
          }
        } catch (e) {
          this.logger.warn('Failed to pre-render tool content', e);
        }

        const formattedDisplay = formatToolCallDisplay(
          toolResult,
          toolResult.toolName,
          preRendered,
          justification
        );

        const payload = {
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          formattedDisplay,
          content: toolResult.content,
          cancelled: options.signal?.aborted === true,
        };

        // Prefer direct callback if provided (Closed Loop for Active UI)
        if (options.onToolResult) {
          await options.onToolResult(payload);
        }

        // Emit hook for global observability (Background tasks / Macros / Other Users)
        Hooks.callAll('simulacrumToolResult', payload);
      }
    } else if (toolResult.role === 'assistant') {
      // Allow empty content to serve as anchor bubbles for tool cards (Fix for Floating Tool Card bug)
      // Only add assistant messages that have actual content (and aren't from loop) to conversation history
      if (!toolResult._fromToolLoop && toolResult.content) {
        this.addMessageToConversation('assistant', toolResult.content);
      }
      await this.addMessageToUI(
        {
          role: 'assistant',
          content: toolResult.content,
          display: toolResult.display || toolResult.content,
        },
        options
      );
    }
  }

  /**
   * Add message to conversation state only
   */
  addMessageToConversation(role, content, toolCalls = null, toolCallId = null, metadata = null) {
    this.conversationManager.addMessage(role, content, toolCalls, toolCallId, metadata);
  }

  /**
   * Add message to UI only (through callback)
   */
  async addMessageToUI(message, options = {}) {
    if (options.onAssistantMessage && message.role === 'assistant') {
      try {
        await options.onAssistantMessage(message);
      } catch (error) {
        this.logger.error('Error in UI callback', error);
      }
    }
  }

  /**
   * Clear conversation history and interaction log
   */
  async clearConversation() {
    this.conversationManager.clear();
    await this.conversationManager.save();
    // Clear the interaction log when conversation is cleared
    const { interactionLogger } = await import('./interaction-logger.js');
    await interactionLogger.clear();
  }
}

export { ChatHandler };
