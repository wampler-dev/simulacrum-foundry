/** A deliberately small, request-scoped tool surface. Permission prompts remain separate. */
const READ = ['search_documents', 'read_document', 'read_tool_output', 'end_loop'];
export const ACTION_TOOL_NAMES = new Set([
  'create_document', 'update_document', 'delete_document', 'document_copy', 'document_move',
  'set_document_ownership', 'run_javascript', 'execute_macro',
]);

export function getTurnToolNames(messages) {
  const request = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const text = typeof request === 'string' ? request : '';
  // Only complete social turns are safe to classify without document access.
  if (/^\s*(?:(?:hi|hello|hey)(?: there)?|(?:thank you|thanks)(?: for (?:your|the) help)?)[.!\s]*$/i.test(text)) {
    return new Set();
  }
  const allowed = new Set(READ);
  const readOnly = /\b(read.only|(?:do not|don't) (?:change|modify|create|delete|execute|run)|without (?:changing|modifying|creating|deleting))\b/i.test(text)
    || /^\s*(?:please\s+)?(?:explain|describe|show me|tell me)\s+(?:how|what)\b/i.test(text)
    || /^\s*how\s+(?:do|can|to)\b/i.test(text);
  if (/\b(?:list|browse|inventory|catalogue|catalog)\b/i.test(text) ||
      /\b(?:show|name|what|which)\b.{0,50}\b(?:all|available)\b.{0,30}\b(?:documents?|actors?|items?|packs?|compendiums?)\b/i.test(text) ||
      /\b(?:which|what)\b.{0,50}\b(?:documents?|actors?|items?|packs?|compendiums?)\b.{0,30}\bavailable\b/i.test(text)) {
    allowed.add('list_documents');
  }
  const existingArtwork = /\b(?:already|currently) uses?\b|\b(?:current|existing) (?:artwork|image|portrait|token)\b/i.test(text);
  const alternativeArtwork = /\b(?:alternative|different|replacement|new)\b/i.test(text);
  if (/\b(art|artwork|image|portrait|token|asset)s?\b/i.test(text) && (!existingArtwork || alternativeArtwork)) {
    allowed.add('search_assets');
  }
  if (/\b(folder|directory|directories)\b/i.test(text)) allowed.add('browse_folders');
  if (/\b(schema|subtype|field structure)\b/i.test(text)) {
    allowed.add('list_document_schemas');
    allowed.add('inspect_document_schema');
  }
  if (readOnly) return allowed;

  if (/\b(create|make|add|generate)\b.{0,80}\b(actor|item|journal|scene|roll table|document|compendium|character|npc|folder)\b/i.test(text)) {
    allowed.add('create_document');
    allowed.add('list_document_schemas');
    allowed.add('inspect_document_schema');
  }
  if (/\b(update|modify|edit|change|set)\b.{0,80}\b(document|actor|item|journal|scene|character|npc|compendium|field|stat|hit points?|hp)\b/i.test(text)) {
    allowed.add('update_document');
    allowed.add('inspect_document_schema');
  }
  if (/\b(delete|remove|destroy)\b.{0,80}\b(document|actor|item|journal|scene|character|npc|compendium)\b/i.test(text)) allowed.add('delete_document');
  if (/\b(copy|duplicate)\b.{0,80}\b(document|actor|item|journal|scene|character|npc)\b/i.test(text)) allowed.add('document_copy');
  if (/\b(move|relocate|transfer)\b.{0,80}\b(document|actor|item|journal|scene|character|npc)\b/i.test(text)) allowed.add('document_move');
  if (/\b(ownership|permission|access)\b/i.test(text) && /\b(set|change|grant|revoke|update|give|remove)\b/i.test(text)) allowed.add('set_document_ownership');
  if (/\b(run|execute)\b.{0,80}\b(javascript|java script|js code|script)\b/i.test(text)) allowed.add('run_javascript');
  if (/\b(run|execute)\b.{0,80}\bmacro\b/i.test(text)) allowed.add('execute_macro');
  return allowed;
}

export function getTurnToolSchemas(messages, registry) {
  const allowed = getTurnToolNames(messages);
  return {
    allowed,
    schemas: registry.getToolSchemas().filter(schema => allowed.has(schema.function?.name || schema.name)),
  };
}
