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
      'Search document names by default. For an exact named reference, set exact=true and optionally source to "world", a pack ID, or an exact pack title; one match supplies identity only, so read_document is still required for facts. Supply indexed field paths for broad searches where available; compendium search uses the pack index, not full contents. Use list_documents to browse without a query.',
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
          exact: {
            type: 'boolean', default: false,
            description: 'Match the complete document name (case insensitive). Returns up to two candidates to distinguish a unique match from ambiguity; use only with the default name field.',
          },
          source: {
            type: 'string',
            description: 'For exact matching, restrict to "world", a pack ID, or an exact visible pack title. Do not combine with pack. An unknown or ambiguous source is an error.',
          },
          maxResults: {
            type: 'integer', minimum: 1, maximum: 100,
            description: 'Broad search limit across all sources: default 50, maximum 100. Exact mode checks up to two matches regardless of this value.',
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
      if (params.source !== undefined && params.exact !== true) {
        throw new Error('source requires exact=true; use pack for broad pack searches');
      }
      const results = await DocumentAPI.searchDocuments({
        query: params.query,
        types: params.documentTypes,
        fields: params.fields,
        maxResults: params.exact === true ? 2 : params.maxResults,
        pack: params.pack,
        source: params.source,
        exact: params.exact === true,
      });

      const resultCount = results.length;
      if (params.exact === true) {
        const status = resultCount === 0 ? 'No exact match' : resultCount === 1 ? 'One exact match' : 'Ambiguous exact name (at least two matches)';
        const guidance = resultCount === 1
          ? 'This match supplies identity only. Call read_document with its arguments for document facts.'
          : resultCount > 1 ? 'Specify a source or ask the user to choose; do not select a candidate arbitrarily.'
            : 'Check the name or source; do not treat a partial name as an exact match.';
        return {
          content: this.formatSearchResults(results, params.query, {
            status: resultCount === 0 ? 'no_match' : resultCount === 1 ? 'unique' : 'ambiguous',
            guidance,
          }),
          display: `${status}. ${guidance}`,
        };
      }
      const maxResults = params.maxResults ?? 50;
      const summary = `${resultCount >= maxResults ? 'Showing up to' : 'Found'} ${resultCount} document${resultCount !== 1 ? 's' : ''} matching "${params.query}"${resultCount >= maxResults ? '; narrow the search for more' : ''}`;
      return {
        content: this.formatSearchResults(results, params.query, {
          status: resultCount === 0 ? 'no_match' : 'results',
          limitReached: resultCount >= maxResults,
          guidance: resultCount >= maxResults
            ? 'Result limit reached; additional matches are unknown. Narrow the query or source.'
            : 'Read a selected document for its facts; search results contain identity only.',
        }),
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
   * Format source-qualified matches for the model without duplicating prose and links.
   * @param {Array} results - Search results
   * @param {string} query - Search query
   * @returns {string} Formatted results
   */
  formatSearchResults(results, query, { status, guidance, limitReached = false }) {
    return JSON.stringify({
      query, status, limitReached, guidance,
      candidates: results.map(doc => {
        const id = doc.id || doc._id;
        if (typeof doc.type !== 'string' || typeof id !== 'string' || !id) {
          throw new Error('Search result lacks a usable document type or ID');
        }
        const sourceTitle = doc.pack && game?.packs?.get?.(doc.pack)?.metadata?.title;
        return {
          name: doc.name || doc.title || doc._id || 'Untitled',
          source: doc.pack || 'world',
          ...(sourceTitle ? { sourceTitle } : {}),
          ...(doc.uuid ? { uuid: doc.uuid } : {}),
          read_document: {
            documentType: doc.type,
            documentId: id,
            ...(doc.pack ? { pack: doc.pack } : {}),
          },
        };
      }),
    });
  }
}

export { DocumentSearchTool };
