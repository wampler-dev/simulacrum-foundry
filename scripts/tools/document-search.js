/**
 * Document Search Tool - Search documents by content or metadata
 */

import { BaseTool } from './base-tool.js';
import { DocumentAPI } from '../core/document-api.js';

class DocumentSearchTool extends BaseTool {
  /**
   * Create a new Document Search Tool
   */
  constructor() {
    super(
      'search_documents',
      'Search document names by default. Supply indexed field paths to search those fields where available; compendium search uses the pack index, not full document contents. Use list_documents to browse without a query. Searches world and compendiums by default.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Non-empty text to match against names, or fields explicitly requested below.',
          },
          documentTypes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Restrict the search to specific document classes (e.g., ["Actor", "Item"]). Omit to search all types.',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Field paths to search (e.g., ["name", "img"]). Omit to search names only. Compendium fields must be available in its index; full document text is not searched.',
          },
          pack: {
            type: 'string',
            description:
              'Restrict the search to a specific compendium pack (e.g., "dnd5e.monsters"). Omit to search the world and all packs.',
          },
          maxResults: {
            type: 'integer', minimum: 1, maximum: 100,
            description: 'Maximum results across all sources. Defaults to 50; at most 100. Narrow the query to find more.',
          },
        },
        required: ['query'],
      }
    );
  }

  /**
   * Execute the tool
   * @param {Object} params - Tool parameters
   * @returns {Object} Tool result
   */
  async execute(params) {
    try {
      const results = await DocumentAPI.searchDocuments({
        query: params.query,
        types: params.documentTypes,
        fields: params.fields,
        maxResults: params.maxResults,
        pack: params.pack,
      });

      const resultCount = results.length;
      const maxResults = params.maxResults ?? 50;
      const summary = `${resultCount >= maxResults ? 'Showing up to' : 'Found'} ${resultCount} document${resultCount !== 1 ? 's' : ''} matching "${params.query}"${resultCount >= maxResults ? '; narrow the search for more' : ''}`;
      return {
        content: this.formatSearchResults(results, params.query),
        display: `<p><strong>${summary}</strong></p>`,
      };
    } catch (error) {
      return {
        content: 'Failed to search documents: ' + error.message,
        display: 'Search failed: ' + error.message,
        error: { message: error.message, type: 'SEARCH_FAILED' },
      };
    }
  }

  /**
   * Format search results for display
   * @param {Array} results - Search results
   * @param {string} query - Search query
   * @returns {string} Formatted results
   */
  formatSearchResults(results, query) {
    if (results.length === 0) {
      return 'No documents found matching "' + query + '"';
    }

    const formattedResults = results.map(doc => {
      const name = doc.name || doc.title || doc._id || 'Untitled';
      const id = doc.id || doc._id || 'Unknown ID';
      const type = doc.type || 'Unknown';
      let uuid = doc.uuid;

      // Construct UUID if missing
      if (!uuid) {
        if (doc.pack) {
          uuid = `Compendium.${doc.pack}.${id}`;
        } else {
          const docType = doc.documentName || doc.constructor?.documentName || type;
          // Basic heuristic if documentName isn't available on the result object
          if (docType) {
            uuid = `${docType}.${id}`;
          }
        }
      }

      if (uuid) {
        const readArgs = JSON.stringify({ documentType: type, documentId: id, ...(doc.pack ? { pack: doc.pack } : {}) });
        return `- @UUID[${uuid}]{${name}} (${type}, id: ${id}; read_document: ${readArgs})`;
      } else {
        return `- **${name}** (Type: ${type}, id: ${id})`;
      }
    });

    return '**Search Results for "' + query + '"**\n' + formattedResults.join('\n');
  }
}

export { DocumentSearchTool };
