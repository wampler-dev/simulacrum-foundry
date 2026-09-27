/**
 * Shared correction helpers for empty-content assistant responses.
 * Ensures the conversation captures a failed assistant turn and a developer
 * instruction before retrying, so the next AI call receives corrective context.
 *
 * Uses 'developer' role for correction instructions (industry standard for
 * programmatic mid-conversation directives). The AI client downgrades to 'user'
 * with a DEVELOPER CORRECTION prefix for backends that don't support it.
 */

/**
 * Append assistant + developer correction messages for an empty or unparseable response.
 *
 * @param {object} conversationManager - Conversation manager instance
 * @param {object|string} errorResponse - Normalized AI response or correction message string
 */
export function appendEmptyContentCorrection(conversationManager, errorResponse) {
  if (!conversationManager) return;

  // Support both object and string inputs
  const content =
    typeof errorResponse === 'string'
      ? errorResponse
      : errorResponse?.content || 'No usable response received';

  // Reconstruct the assistant's failed message as a combined content turn.
  // NOTE: We intentionally do NOT include tool_calls in the correction message.
  // If we added tool_calls here, we'd also need to add corresponding tool response
  // messages, otherwise Mistral (and other strict APIs) will fail with:
  // "Not the same number of function calls and responses"
  const combinedContent = `(Response rejected: ${content})`;

  // Add the assistant failed turn WITHOUT tool_calls to avoid message parity issues
  // Mark as _internal so it's not displayed to users on reload
  conversationManager.addMessage('assistant', combinedContent, null, null, { _internal: true });

  // A valid final answer may be plain text; a tool call is only needed for real work.
  const correctionInstruction =
    'Your previous response was empty or could not be parsed. Respond with a useful plain-language answer, or call a tool if the requested work requires one.';
  conversationManager.addMessage('developer', correctionInstruction);
}

/**
 * Append assistant + developer correction messages for malformed tool call responses.
 * Ensures the next retry has natural-language context instead of repeating the
 * invalid tool invocation.
 *
 * @param {object} conversationManager - Conversation manager instance
 * @param {object} errorResponse - Normalized AI response with raw provider payload
 */
export function appendToolFailureCorrection(conversationManager, errorResponse) {
  if (!conversationManager) return;

  const functionName = (() => {
    try {
      const candidates = errorResponse?._originalResponse?.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part?.functionCall?.name) {
            return part.functionCall.name;
          }
        }
      }
    } catch (_e) {
      /* ignore */
    }
    return null;
  })();

  const assistantSummary = functionName
    ? `Previous tool call "${functionName}" failed because the provider reported malformed arguments. The tool call has been removed.`
    : 'Previous tool call failed because the provider reported malformed arguments. The malformed tool call has been removed.';

  // Mark as _internal so it's not displayed to users on reload
  conversationManager.addMessage('assistant', assistantSummary, null, null, { _internal: true });

  const correctionInstruction =
    'Your last reply attempted to call a tool with invalid or malformed arguments. Provide corrected arguments if a tool call is still required, or respond in plain language without using tools.';
  conversationManager.addMessage('developer', correctionInstruction);
}
