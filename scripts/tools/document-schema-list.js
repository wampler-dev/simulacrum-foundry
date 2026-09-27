/**
 * Document Schema List Tool - List all document types with subtypes and counts
 */

import { BaseTool } from './base-tool.js';

class DocumentSchemaListTool extends BaseTool {
  constructor() {
    super(
      'list_document_schemas',
      'List available document types and subtypes when the type or subtype is unknown. Returns type names, subtypes, world counts, and pack counts. Inspect a specific schema only when its field structure is needed.',
      { type: 'object', properties: {} }
    );
  }

  async execute() {
    const types = this.#getAllDocumentTypesWithSubtypes();
    return {
      content: `Available document types:\n${JSON.stringify(types, null, 2)}`,
      display: `Found **${types.length}** document types`,
    };
  }

  #getAllDocumentTypesWithSubtypes() {
    return Object.keys(game?.documentTypes || {})
      .filter(type => game?.collections?.get(type) !== undefined)
      .sort()
      .map(type => {
        const subtypes = game.documentTypes[type] || [];
        const world = game.collections.get(type)?.size || 0;
        const compendiums = game.packs?.filter(p => p.documentName === type).length ?? 0;
        return { name: type, subtypes, world, compendiums };
      });
  }
}

export { DocumentSchemaListTool };
