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
      'Search document names by default. For a requested book/module, first use list_documents(documentType="Compendium") to select its source package, then list that packageId to obtain its pack IDs, unless already known from tool results. Do not guess pack IDs or substitute a different named document. Broad name searches also report multiple complete-name matches as ambiguous. For an exact named reference, set exact=true and optionally source to "world", a pack ID, or an exact pack title; one match supplies identity only, so read_document is still required for facts. Supply indexed field paths for broad searches where available; compendium search uses the pack index, not full contents. Use list_documents to browse without a query.',
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
              'Restrict the search to a specific compendium pack (copy an ID from compendium discovery). Omit to search the world and all packs.',
          },
          exact: {
            type: 'boolean', default: false,
            description: 'Match the complete document name (case insensitive). Returns up to ten source-qualified candidates; use only with the default name field.',
          },
          source: {
            type: 'string',
            description: 'For exact matching, restrict to "world", a pack ID, or an exact visible pack title. Do not combine with pack. An unknown or ambiguous source is an error.',
          },
          maxResults: {
            type: 'integer', minimum: 1, maximum: 100,
            description: 'Broad search limit across all sources: default 50, maximum 100. Exact mode checks up to ten matches regardless of this value.',
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
        maxResults: params.exact === true ? 10 : params.maxResults,
        pack: params.pack,
        source: params.source,
        exact: params.exact === true,
      });

      const resultCount = results.length;
      const requestedSource = params.pack || params.source || 'all accessible sources';
      if (params.exact === true) {
        const limitReached = resultCount >= 10;
        const status = resultCount === 0 ? 'No exact match' : resultCount === 1 && !limitReached ? 'One exact match' : `Ambiguous exact name (${limitReached ? 'at least ' : ''}${resultCount} matches)`;
        const guidance = resultCount === 1
          ? 'This match supplies identity only. Call read_document with its arguments for document facts.'
          : resultCount > 1 ? `Ask the user to choose a source/document; do not select a candidate arbitrarily.${limitReached ? ' Additional matches may exist; use source discovery if the requested source is not shown.' : ''}`
            : 'Check the name or source; do not treat a partial name as an exact match.';
        return {
          content: this.formatSearchResults(results, params.query, {
            requestedSource,
            status: resultCount === 0 ? 'no_match' : resultCount === 1 ? 'unique' : 'ambiguous',
            guidance, limitReached,
          }),
          display: `${status}. Searched source: ${requestedSource}. ${guidance}`,
        };
      }
      // A broad name search must not erase ambiguity in complete-name matches.
      const nameSearch = !Array.isArray(params.fields) || params.fields.length === 0 ||
        (params.fields.length === 1 && params.fields[0] === 'name');
      const exactMatches = nameSearch ? results.filter(doc =>
        typeof doc.name === 'string' && doc.name.trim().toLowerCase() === params.query.trim().toLowerCase()) : [];
      if (exactMatches.length > 1) {
        const guidance = 'Multiple documents have this exact name. Ask the user to choose a source/document before reading one as the answer. Do not choose arbitrarily. Repeat the exact search with the chosen source.';
        return {
          content: this.formatSearchResults(exactMatches, params.query, {
            requestedSource, status: 'ambiguous', guidance,
            limitReached: results.length >= (params.maxResults ?? 50),
          }),
          display: `Ambiguous exact name: at least ${exactMatches.length} matches for "${params.query}". Ask the user to choose a source.`,
        };
      }
      const maxResults = params.maxResults ?? 50;
      const summary = `${resultCount >= maxResults ? 'Showing up to' : 'Found'} ${resultCount} document${resultCount !== 1 ? 's' : ''} matching "${params.query}" in ${requestedSource}${resultCount >= maxResults ? '; narrow the search for more' : ''}`;
      return {
        content: this.formatSearchResults(results, params.query, {
          requestedSource,
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
  formatSearchResults(results, query, { status, guidance, requestedSource, limitReached = false }) {
    return JSON.stringify({
      query, status, requestedSource, limitReached, guidance,
      candidates: results.map(doc => {
        const id = doc.id || doc._id;
        if (typeof doc.type !== 'string' || typeof id !== 'string' || !id) {
          throw new Error('Search result lacks a usable document type or ID');
        }
        const pack = doc.pack && game?.packs?.get?.(doc.pack);
        const packageId = doc.pack && (pack?.metadata?.packageName || doc.pack.split('.')[0]);
        const sourceTitle = pack?.title || pack?.metadata?.title;
        const packageTitle = packageId && (game.modules?.get?.(packageId)?.title ||
          (game.system?.id === packageId ? game.system.title : undefined));
        return {
          name: doc.name || doc.title || doc._id || 'Untitled',
          source: doc.pack || 'world',
          ...(sourceTitle ? { sourceTitle } : {}),
          ...(packageTitle ? { packageTitle } : {}),
          ...(doc.uuid ? { uuid: doc.uuid } : {}),
          ...(status === 'ambiguous' ? { documentType: doc.type, documentId: id } : { read_document: {
            documentType: doc.type,
            documentId: id,
            ...(doc.pack ? { pack: doc.pack } : {}),
          } }),
        };
      }),
    });
  }
}

export { DocumentSearchTool };
