/** A deliberately small, request-scoped tool surface. Permission prompts remain separate. */
const READ = ['search_documents', 'list_documents', 'read_document', 'read_tool_output', 'end_loop'];

export function getTurnToolNames(messages) {
  const request = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const text = typeof request === 'string' ? request : '';
  const allowed = new Set(READ);
  const readOnly = /\b(read.only|(?:do not|don't) (?:change|modify|create|delete|execute|run)|without (?:changing|modifying|creating|deleting))\b/i.test(text)
    || /^\s*(?:please\s+)?(?:explain|describe|show me|tell me)\s+(?:how|what)\b/i.test(text)
    || /^\s*how\s+(?:do|can|to)\b/i.test(text);
  if (/\b(art|artwork|image|portrait|token|asset)s?\b/i.test(text)) allowed.add('search_assets');
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
