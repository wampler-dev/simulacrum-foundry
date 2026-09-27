/**
 * Document List Tool - List documents of any type available in current system
 */

import { BaseTool } from './base-tool.js';
import { DocumentAPI } from '../core/document-api.js';

class DocumentListTool extends BaseTool {
  /**
   * Create a new Document List Tool
   */
  constructor() {
    super(
      'list_documents',
      'List documents by type, returning names, IDs, and UUID references. Use this to browse or inventory documents when you do not have a specific search term — for targeted text searches, use `search_documents` instead. Omit `documentType` to list all available document types with counts. Pass documentType="Compendium" to list source packages, then pass the selected packageId to list its exact pack IDs. Follow nextPage when present.',
      {
        type: 'object',
        properties: {
          documentType: {
            type: 'string',
            description:
              'The document class to list (e.g., Actor, Item, JournalEntry, RollTable, Folder). Omit to list all available document types with counts. Pass "Compendium" to discover source packages and their packs.',
          },
          packageId: {
            type: 'string',
            description: 'Only with documentType="Compendium": an exact packageId returned by source discovery. Lists packs owned by that source; package IDs are not pack IDs.',
          },
          pageOffset: {
            type: 'integer', minimum: 0,
            description: 'Only for Compendium discovery: use the nextPage arguments from a prior result; defaults to zero.',
          },
          filters: {
            type: 'object',
            description:
              'An object of filter criteria to narrow results (e.g., `{"name": "Goblin", "folder": "folderId"}`). Applied as field-level matches.',
          },
          includeCompendiums: {
            type: 'boolean',
            default: false,
            description:
              'Whether to also include documents from compendium packs in the results. Defaults to false. Prefer using the `pack` parameter to target a specific compendium.',
          },
          pack: {
            type: 'string',
            description:
              'A specific compendium pack ID to list documents from (copy an ID returned by compendium discovery). When set, only documents from this pack are returned.',
          },
        },
      }
    );
  }

  /**
   * Execute the tool
   * @param {Object} params - Tool parameters
   * @returns {Object} Tool result
   */
  async execute(params) {
    if ((params.packageId !== undefined || params.pageOffset !== undefined) && params.documentType !== 'Compendium') {
      const message = 'packageId and pageOffset apply only to Compendium discovery';
      return { content: message, error: { type: 'DISCOVERY_FAILED', message } };
    }
    // If no documentType specified, list all available document types
    if (!params.documentType) {
      return this.listAllDocumentTypes();
    }

    // If documentType is "Compendium", list available packs
    if (params.documentType === 'Compendium') {
      return this.listCompendiumSources(params);
    }

    // Validate document type exists in current system (unless reading from a pack, which might have its own types)
    // Actually, even in packs, types should be valid.
    if (params.documentType && !this.isValidDocumentType(params.documentType) && !params.pack) {
      return {
        content: 'Document type "' + params.documentType + '" not available in current system',
        display: 'Unknown document type: ' + params.documentType,
        error: { message: 'Invalid document type', type: 'UNKNOWN_DOCUMENT_TYPE' },
      };
    }

    try {
      const documents = await DocumentAPI.listDocuments(params.documentType, {
        filters: params.filters,
        pack: params.pack,
      });

      return {
        content: this.formatDocumentList(documents, params.documentType),
        display: `Found **${documents.length}** ${params.documentType || ''} documents`,
      };
    } catch (error) {
      return {
        content: 'Failed to list documents: ' + error.message,
        display: 'Error listing documents: ' + error.message,
        error: { message: error.message, type: 'LIST_FAILED' },
      };
    }
  }

  /**
   * List all available document types
   * @returns {Object} Tool result with document types
   */
  listAllDocumentTypes() {
    try {
      const documentTypes = DocumentAPI.getAllDocumentTypes();

      if (documentTypes.length === 0) {
        return {
          content: 'No document types available',
          display: 'No document types available in current system',
        };
      }

      // Try to get sample documents for each type to show names
      const typeInfo = documentTypes.map(type => {
        try {
          const collection = game.collections.get(type);
          if (collection && collection.contents && collection.contents.length > 0) {
            // Get a few sample document names
            const samples = collection.contents.slice(0, 3).map(doc => {
              const obj = doc.toObject ? doc.toObject() : doc;
              return obj.name || obj._id || 'Unnamed';
            });
            return type + ' (' + collection.contents.length + ' documents): ' + samples.join(', ');
          } else {
            return type + ' (0 documents)';
          }
        } catch (e) {
          return type + ' (Unknown)';
        }
      });

      return {
        content: '**Available Document Types**\n' + typeInfo.join('\n'),
        display: `Found **${documentTypes.length}** document types`,
      };
    } catch (error) {
      return {
        content: 'Failed to list document types: ' + error.message,
        display: 'Error listing document types: ' + error.message,
        error: { message: error.message, type: 'LIST_TYPES_FAILED' },
      };
    }
  }

  /**
   * Format document list for display
   * @param {Array} documents - Documents to format
   * @param {string} documentType - Document type
   * @returns {string} Formatted document list
   */
  formatDocumentList(documents, documentType) {
    if (documents.length === 0) {
      return 'No ' + (documentType || '') + ' documents found';
    }

    // Format each document with its name and UUID
    const formattedDocs = documents.map(doc => {
      const name = doc.name || 'Unnamed';
      const id = doc.id || doc._id || 'Unknown ID';
      let uuid = doc.uuid;

      // Construct UUID if missing (e.g. from plain objects)
      if (!uuid) {
        if (doc.pack) {
          uuid = `Compendium.${doc.pack}.${id}`;
        } else {
          // Document types in Foundry are generally the constructor name
          // But here we likely have the type name passed in params or need to guess
          const type = doc.documentName || documentType;
          if (type) {
            uuid = `${type}.${id}`;
          }
        }
      }

      // Fallback if we still can't determine UUID
      if (uuid) {
        return `@UUID[${uuid}]{${name}} (id: ${id})`;
      } else {
        return `${name} (id: ${id})`;
      }
    });

    return (
      '**' +
      documentType +
      ' Documents** (' +
      documents.length +
      ' total):\n' +
      formattedDocs.join('\n')
    );
  }

  /**
   * Group documents by type
   * @param {Array} documents - Documents to group
   * @returns {Object} Grouped documents
   */
  groupByType(documents) {
    const grouped = {};
    documents.forEach(doc => {
      const type = doc.documentName || doc.type || 'Unknown';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(doc);
    });
    return grouped;
  }

  /** Small source/pack pages stay below the dispatcher's generic compaction threshold. */
  listCompendiumSources({ packageId, pageOffset = 0 }) {
    const fail = message => ({ content: message, error: { type: 'DISCOVERY_FAILED', message } });
    if (!Number.isInteger(pageOffset) || pageOffset < 0) return fail('pageOffset must be a non-negative integer');
    if (packageId !== undefined && (typeof packageId !== 'string' || !packageId)) {
      return fail('packageId must be an exact source ID returned by discovery');
    }
    const packs = DocumentAPI.listPacks();
    let entries;
    if (packageId !== undefined) {
      entries = packs.filter(p => p.packageId === packageId).map(p => ({
        pack: p.id, title: p.title, documentType: p.documentName,
      }));
      if (!entries.length) return fail('No readable packs belong to that packageId; list source packages first');
    } else {
      const sources = new Map();
      for (const p of packs) {
        const source = sources.get(p.packageId) || { packageId: p.packageId, title: p.packageTitle, packCount: 0 };
        source.packCount++;
        sources.set(p.packageId, source);
      }
      entries = [...sources.values()];
    }
    entries.sort((a, b) => (a.pack || a.packageId).localeCompare(b.pack || b.packageId));
    if (pageOffset > 0 && pageOffset >= entries.length) return fail('pageOffset is outside the current catalog; restart at zero');
    const rows = [];
    const makeResult = () => {
      const nextOffset = pageOffset + rows.length;
      const nextPage = nextOffset < entries.length
        ? { documentType: 'Compendium', ...(packageId !== undefined ? { packageId } : {}), pageOffset: nextOffset } : null;
      return {
        content: JSON.stringify({ kind: packageId === undefined ? 'sources' : 'packs',
          ...(packageId !== undefined ? { packageId } : {}), total: entries.length, entries: rows, nextPage,
          guidance: packageId === undefined
            ? 'Select the requested source by title, then call list_documents with documentType="Compendium" and its packageId. A packageId is not a pack ID.'
            : 'Use the exact pack ID with the required documentType in search_documents. Do not substitute another source.' }),
        display: `Showing ${rows.length} of ${entries.length} ${packageId === undefined ? 'source packages' : 'packs'}${nextPage ? '; more pages available' : ''}`,
      };
    };
    for (const entry of entries.slice(pageOffset, pageOffset + 20)) {
      rows.push(entry);
      if (JSON.stringify(makeResult()).length > 3500) { rows.pop(); break; }
    }
    if (entries.length && !rows.length) return fail('A catalog entry exceeds the discovery output budget; source identity was not truncated');
    return makeResult();
  }

}

// Export the DocumentListTool class
export { DocumentListTool };
