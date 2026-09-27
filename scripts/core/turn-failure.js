/** Deterministic terminal result when a requested tool action did not complete. */
export function toolFailureMessage(reason = 'tool_failure') {
  const content = reason === 'action_not_executed'
    ? 'I did not execute the requested action. Please clarify any missing details or retry.'
    : 'I could not verify completion of the requested work. Review the tool error and any partial results before retrying.';
  return { role: 'assistant', content, display: content, toolCalls: [], _terminalReason: reason };
}
