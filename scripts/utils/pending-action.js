export function looksLikePendingToolAction(content, tools = []) {
  const text = String(content ?? '').trim().toLowerCase();
  if (!text || text.length > 500) return false;

  const available = new Set(
    (tools ?? []).map(tool => tool?.function?.name ?? tool?.name).filter(Boolean)
  );
  if (available.size === 0) return false;

  const progressWords = [
    'resolving', 'searching', 'looking', 'reading', 'retrieving',
    'browsing', 'inspecting', 'checking', 'let me', 'need to', 'going to',
  ];
  if (!progressWords.some(word => text.includes(word))) return false;

  const hints = {
    resolve_reference: ['resolv', 'reference'],
    read_document: ['read', 'retriev', 'document', 'mechanical data'],
    search_documents: ['search', 'document', 'compendium'],
    search_assets: ['search', 'asset', 'token', 'portrait', 'image'],
    browse_folders: ['brows', 'folder'],
  };

  return Object.entries(hints).some(([name, words]) =>
    available.has(name) && words.some(word => text.includes(word))
  );
}
