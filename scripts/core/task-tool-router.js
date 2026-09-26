/* eslint-disable no-unused-vars */
/**
 * Task Tool Router
 *
 * Selects a task-scoped subset of registered tool schemas for each user turn.
 * All tools remain registered; only the schemas relevant to the current task
 * are exposed to the model. Profiles compose for mixed requests.
 */

const BASE_TOOLS = ['read_tool_output', 'end_loop'];
const RESEARCH_TOOLS = ['search_documents', 'read_document', 'list_documents'];
const AUTHORING_TOOLS = [
  'create_document',
  'update_document',
  'inspect_document_schema',
  'list_document_schemas',
  'manage_task',
];
const ASSET_TOOLS = ['search_assets', 'browse_folders'];
const AUTOMATION_TOOLS = ['execute_macro', 'run_javascript'];
const ADMIN_TOOLS = [
  'delete_document',
  'document_copy',
  'document_move',
  'set_document_ownership',
];

const INTENT_PATTERNS = {
  authoring:
    /\b(create|make|add|build|edit|update|change|modify|write|populate|import)\b/i,
  assets:
    /\b(image|images|portrait|portraits|token|tokens|art|artwork|audio|sound|sounds|music|file|files|asset|assets|map|maps)\b/i,
  automation:
    /\b(macro|macros|javascript|java\s*script|script|scripts|execute\s+(?:a\s+)?macro|run\s+(?:a\s+)?script)\b/i,
  admin:
    /\b(delete|remove|move|copy|duplicate|ownership|permission|permissions|access\s+control)\b/i,
};

function getLatestUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return String(messages[i]?.content ?? '');
  }
  return '';
}

function addTools(target, names) {
  for (const name of names) target.add(name);
}

/**
 * Select tool schemas for one user turn.
 *
 * Research is the conservative default. Additional profiles are composed only
 * when the latest user request indicates that capability is relevant.
 *
 * @param {Array} messages Conversation messages
 * @param {Array} allSchemas Full ToolRegistry schema list
 * @returns {Array} Filtered schemas in registry order
 */
export function selectToolSchemasForTurn(messages, allSchemas) {
  if (!Array.isArray(allSchemas)) return allSchemas;

  const text = getLatestUserText(messages);
  const selected = new Set();
  addTools(selected, BASE_TOOLS);
  addTools(selected, RESEARCH_TOOLS);

  const explicitlyReadOnly =
    /\b(do not|don't|dont|without)\s+(modify|change|edit|update|create|write|import)\b/i.test(
      text
    );

  if (!explicitlyReadOnly && INTENT_PATTERNS.authoring.test(text)) {
    addTools(selected, AUTHORING_TOOLS);
  }
  if (INTENT_PATTERNS.assets.test(text)) addTools(selected, ASSET_TOOLS);
  if (INTENT_PATTERNS.automation.test(text)) addTools(selected, AUTOMATION_TOOLS);
  if (INTENT_PATTERNS.admin.test(text)) addTools(selected, ADMIN_TOOLS);

  return allSchemas.filter(schema => {
    const name = schema?.function?.name || schema?.name;
    return selected.has(name);
  });
}
