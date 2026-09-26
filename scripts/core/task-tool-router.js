/**
 * Task-scoped tool routing.
 *
 * Keep the model's capability surface as small as possible for each turn.
 * Mechanical intent classification controls capability exposure; the model
 * does not decide whether unrelated administrative tools should exist.
 */

const ALWAYS = ['end_loop'];
const READ_ONLY = [
  'resolve_reference',
  'read_document',
  'search_documents',
  'search_assets',
  'browse_folders',
  'read_tool_output',
  ...ALWAYS,
];
const AUTHORING = [
  ...READ_ONLY,
  'create_document',
  'update_document',
  'inspect_document_schema',
  'manage_task',
];
const DESTRUCTIVE = ['delete_document', 'document_copy', 'document_move'];
const ADMIN = ['set_document_ownership'];
const AUTOMATION = ['run_javascript', 'execute_macro'];
const BROWSE = ['list_documents'];

function has(text, pattern) {
  return pattern.test(String(text ?? ''));
}

export function selectToolNamesForTurn(text) {
  const value = String(text ?? '');
  const selected = new Set(READ_ONLY);

  const explicitReadOnly = has(
    value,
    /\b(do not|don't|dont|without)\s+(modify|change|edit|update|create|write|import|delete|remove)\b/i
  );
  const authoring = has(
    value,
    /\b(create|update|modify|change|edit|write|import|add|set|assign)\b/i
  );
  const destructive = has(value, /\b(delete|remove|move|copy|duplicate)\b/i);
  const ownership = has(value, /\b(ownership|permission|permissions|access level)\b/i);
  const automation = has(value, /\b(javascript|java script|macro|script|automation)\b/i);
  const browse = has(
    value,
    /\b(list|browse|inventory|show)\b.*\b(documents?|compendiums?|packs?)\b/i
  );

  if (!explicitReadOnly && authoring) {
    for (const name of AUTHORING) selected.add(name);
  }
  if (!explicitReadOnly && destructive) {
    for (const name of DESTRUCTIVE) selected.add(name);
  }
  if (ownership) {
    for (const name of ADMIN) selected.add(name);
  }
  if (automation) {
    for (const name of AUTOMATION) selected.add(name);
  }
  if (browse) {
    for (const name of BROWSE) selected.add(name);
  }

  // Schema enumeration is intentionally never exposed. The model does not
  // need to enumerate all document types to perform a task. Structural work
  // receives inspect_document_schema only.
  return [...selected];
}

export function selectToolSchemasForTurn(text, schemas) {
  const allowed = new Set(selectToolNamesForTurn(text));
  return (schemas ?? []).filter(schema =>
    allowed.has(schema?.function?.name ?? schema?.name)
  );
}


function _resolvedArtworkPresent(toolResults) {
  for (const item of toolResults ?? []) {
    if (item?.toolName !== 'resolve_reference' || item?.success !== true) continue;
    const content = item?.result?.content;
    if (typeof content !== 'string') continue;
    try {
      const parsed = JSON.parse(content);
      if ((parsed.matches ?? []).some(match => match?.img || match?.tokenImg)) return true;
    } catch (_error) {
      // A malformed resolver result must not change capability exposure.
    }
  }
  return false;
}

export function refineToolSchemasAfterResults(text, schemas, toolResults) {
  const wantsAlternatives =
    /\b(alternative|alternatives|alternate|another|other|different|more|options)\b/i.test(
      String(text ?? '')
    );

  if (wantsAlternatives || !_resolvedArtworkPresent(toolResults)) return schemas ?? [];

  return (schemas ?? []).filter(schema => {
    const name = schema?.function?.name ?? schema?.name;
    return name !== 'search_assets' && name !== 'browse_folders';
  });
}
