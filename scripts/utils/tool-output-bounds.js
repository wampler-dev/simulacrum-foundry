export const MAX_RETAINED_OUTPUT_CHARS = 64000;
export const MAX_RETAINED_OUTPUTS = 4;

/** Store only a bounded portion of a tool result in persistent conversation state. */
export function retainToolOutput(buffer, id, content) {
  const originalLength = content.length;
  const truncated = originalLength > MAX_RETAINED_OUTPUT_CHARS;
  const retained = truncated
    ? `${content.slice(0, MAX_RETAINED_OUTPUT_CHARS)}\n[Output truncated in storage; refine the original request for later content.]`
    : content;
  buffer.delete(id);
  buffer.set(id, retained);
  while (buffer.size > MAX_RETAINED_OUTPUTS) buffer.delete(buffer.keys().next().value);
  return { retained, truncated, originalLength };
}

export function restoreToolOutputs(entries) {
  const buffer = new Map();
  if (!Array.isArray(entries)) return buffer;
  for (const entry of entries) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      retainToolOutput(buffer, entry[0], entry[1]);
    }
  }
  return buffer;
}

export function compactToolStatus(result) {
  const error = result.error == null ? {} : {
    error: typeof result.error === 'string'
      ? result.error.slice(0, 500)
      : { type: String(result.error.type || 'Error').slice(0, 80), message: String(result.error.message || 'Tool failed').slice(0, 500) },
  };
  const partial = result.partial == null ? {} : {
    partial: JSON.stringify(result.partial).length <= 1200 ? result.partial : {
      _truncated: true,
      copyCompleted: result.partial.copyCompleted,
      sourceState: result.partial.sourceState,
      documentId: result.partial.document?.id,
    },
  };
  return { ...error, ...partial };
}
