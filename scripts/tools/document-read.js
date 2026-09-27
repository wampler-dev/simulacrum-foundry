/**
 * Document Reading Tool
 * Reads and retrieves documents from FoundryVTT using the Document API
 */

import { BaseTool } from './base-tool.js';
import { createLogger } from '../utils/logger.js';
import { documentReadRegistry } from '../utils/document-read-registry.js';

/**
 * Document Reading Tool
 */
export class DocumentReadTool extends BaseTool {
  constructor() {
    super(
      'read_document',
      'Read selected document fields or the document data without embedded collections by default. Set includeEmbedded=true to read embedded collections. Large results require narrower fields or line ranges. This read establishes the source-qualified prerequisite for update/delete.'
    );
    this.logger = createLogger('DocumentReadTool');
    this.schema = {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          description:
            'The document class to read (e.g., Actor, Item, JournalEntry, RollTable, Scene).',
        },
        documentId: {
          type: 'string',
          description:
            'The raw document ID or a top-level world/compendium UUID. Search results include ready-to-use read_document arguments. Embedded UUIDs are not supported.',
        },
        includeEmbedded: {
          type: 'boolean',
          default: false,
          description:
            'Include embedded document collections such as items, pages, effects, and tokens. Defaults to false.',
        },
        fields: {
          type: 'array', minItems: 1, items: { type: 'string' },
          description: 'Optional dot-path fields to return, such as ["name", "system.attributes.ac.value", "prototypeToken.texture.src"]. Missing fields are listed explicitly.',
        },
        pack: {
          type: 'string',
          description:
            'The compendium pack ID if reading from a compendium (e.g., "dnd5e.monsters"). Omit to read from the world.',
        },
        startLine: {
          type: 'integer',
          minimum: 1,
          description:
            'The starting line number for paginated reading of large documents (1-indexed). Omit to return the full document.',
        },
        endLine: {
          type: 'integer',
          minimum: 1,
          description:
            'The ending line number for paginated reading (1-indexed, inclusive). Omit to return the full document.',
        },
      },
      required: ['documentType', 'documentId'],
    };
  }

  /**
   * Get the parameter schema for this tool
   */
  getParameterSchema() {
    return this._addResponseParam(this.schema);
  }

  /**
   * Execute document reading
   * @param {Object} parameters - Reading parameters
   * @returns {Promise<Object>} Reading result with document data
   */
  async execute(parameters) {
    try {
      this.validateParameters(parameters, this.schema);
      const { documentType } = parameters;
      const { documentId, pack } = this._resolveDocumentIdentity(parameters);

      if (!this.isValidDocumentType(documentType) && !pack) {
        return this._createErrorResponse(
          documentType,
          'DOCUMENT_TYPE_INVALID',
          `Document type "${documentType}" not available in current system`
        );
      }

      const includeEmbedded = parameters.includeEmbedded === true;
      let fullSnapshot;
      const document = await this._fetchDocument(documentType, documentId, {
        pack, includeEmbedded, onFullDocument: snapshot => { fullSnapshot = snapshot; },
      });
      if (!document) {
        return this._createErrorResponse(documentType, 'DOCUMENT_NOT_FOUND', 'Document not found');
      }

      const content = this._formatDocumentContent(document, documentId, { ...parameters, pack });
      if (content.length + documentType.length + (document?.name || documentId).length + 8 > 12000) {
        return this._createErrorResponse(documentType, 'READ_TOO_LARGE',
          'Read output exceeds 12000 characters. Request specific fields or a narrower line range.');
      }
      // The mutation prerequisite compares the authoritative full snapshot, even for a selected read.
      const fullDocument = fullSnapshot || document;
      const data = typeof fullDocument?.toObject === 'function' ? fullDocument.toObject() : fullDocument;
      documentReadRegistry.registerRead(documentType, documentId, data, pack);
      const documentName = document?.name || documentId;

      return {
        content: `Read ${documentType}: ${documentName}\n\n${content}`,
        display: `**${documentName}** (${documentType})`,
      };
    } catch (error) {
      const isNotFound =
        error.message.includes('Document not found') || error.message.includes('not found');
      const code = isNotFound ? 'DOCUMENT_NOT_FOUND' : 'UNKNOWN_ERROR';
      return this._createErrorResponse(parameters.documentType, code, error.message);
    }
  }

  _resolveDocumentIdentity({ documentType, documentId, pack }) {
    const value = documentId.trim();
    const linked = value.match(/^@UUID\[([^\]]+)\](?:\{[^}]*\})?$/);
    if (value.startsWith('@UUID[') && !linked) throw new Error('Invalid UUID reference');
    const uuid = linked ? linked[1] : value;
    if (!uuid.includes('.')) return { documentId: uuid, pack };

    if (uuid.startsWith('Compendium.')) {
      const segments = uuid.split('.');
      if (segments.length !== 4 && segments.length !== 5) {
        throw new Error('Only top-level compendium document UUIDs are supported');
      }
      const uuidPack = segments.slice(1, 3).join('.');
      const uuidType = segments.length === 5 ? segments[3] : null;
      const id = segments.at(-1);
      if (!id || (uuidType && uuidType !== documentType) || (pack && pack !== uuidPack)) {
        throw new Error('Document UUID does not match the requested type or pack');
      }
      return { documentId: id, pack: uuidPack };
    }

    const segments = uuid.split('.');
    if (segments.length !== 2 || segments[0] !== documentType || !segments[1] || pack) {
      throw new Error('Document UUID does not match the requested type or source, or is embedded');
    }
    return { documentId: segments[1] };
  }

  async _fetchDocument(type, id, options = {}) {
    const { DocumentAPI } = await import('../core/document-api.js');
    return DocumentAPI.getDocument(type, id, options);
  }

  _formatDocumentContent(document, id, params) {
    const data = typeof document?.toObject === 'function' ? document.toObject() : document;
    let selected = data;
    if (params.fields !== undefined) {
      if (!Array.isArray(params.fields) || params.fields.length === 0 || params.fields.some(field => typeof field !== 'string' || !field.trim())) {
        throw new Error('fields must be a non-empty array of dot-path strings');
      }
      const fields = Object.create(null);
      const missingFields = [];
      for (const path of params.fields) {
        const value = path.split('.').reduce((part, key) =>
          part != null && Object.hasOwn(Object(part), key) ? part[key] : undefined, data);
        if (value === undefined) missingFields.push(path);
        else fields[path] = value;
      }
      selected = { documentType: params.documentType, documentId: id, ...(params.pack ? { pack: params.pack } : {}), fields, missingFields };
    }
    const json = JSON.stringify(selected, null, 2);

    if (!params.startLine && !params.endLine) return json;
    return this._paginateContent(json, params.startLine, params.endLine);
  }

  _paginateContent(json, startLine, endLine) {
    if ((startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1)) ||
        (endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1 || endLine < (startLine || 1)))) {
      throw new Error('startLine and endLine must be positive integers in ascending order');
    }
    const lines = json.split('\n');
    const total = lines.length;
    const start = Math.max(0, (startLine || 1) - 1);
    const end = endLine ? Math.min(total, endLine) : total;

    if (start >= total) {
      throw new Error(`Start line ${start + 1} exceeds line count ${total}`);
    }

    const slice = lines.slice(start, end).join('\n');
    return `[Paginated View: Lines ${start + 1}-${end} of ${total}]\n${slice}`;
  }

  _createErrorResponse(type, code, message) {
    return {
      content: `Failed to read ${type} document: ${message}`,
      display: `Error reading document: ${message}`,
      error: { message, type: code },
    };
  }

  /**
   * Prepare document data for response, respecting depth limits
   * @param {Object} document - The original document
   * @param {Array} fields - Specific fields to include
   * @param {number} depth - Maximum depth for nested references
   * @returns {Object} Processed document data
   */
  async prepareDocumentData(document, fields, depth) {
    if (!document) return null;

    let data = { ...document };

    // If specific fields requested, filter to only those
    if (fields && fields.length > 0) {
      const filtered = {};
      for (const field of fields) {
        if (field in document) {
          filtered[field] = document[field];
        }
      }
      data = filtered;
    }

    // Handle depth-limited reference resolution
    if (depth > 0) {
      data = await this.processReferences(data, depth - 1);
    }

    return data;
  }

  /**
   * Process document references recursively with depth limitation
   * @param {Object} data - Document data to process
   * @param {number} remainingDepth - Remaining depth for processing
   * @returns {Object} Processed data with resolved references
   */
  async processReferences(data, remainingDepth) {
    if (!data || remainingDepth < 0) return data;

    // Handle case where data is an array of documents
    if (Array.isArray(data)) {
      return Promise.all(data.map(item => this.processReferences(item, remainingDepth)));
    }

    // Handle case where data is an object
    if (typeof data === 'object') {
      const processed = { ...data };

      // Remove system-specific fields that might clutter response
      const fieldsToRemove = ['_index', 'collection', '_createId', 'apps', '_sheet'];
      fieldsToRemove.forEach(field => delete processed[field]);

      // Process nested objects
      for (const key in processed) {
        if (processed[key] && typeof processed[key] === 'object') {
          try {
            processed[key] = await this.processReferences(processed[key], remainingDepth - 1);
          } catch (error) {
            this.logger.warn(`Error processing nested reference in field ${key}:`, error);
            // Keep original reference if processing fails
          }
        }
      }

      return processed;
    }

    return data;
  }

  /**
   * Get example usage for this tool
   */
  getExamples() {
    return [
      {
        description: 'Read a document by ID (example)',
        parameters: {
          documentType: 'SomeDocumentType',
          id: 'DOCUMENT_ID_HERE',
        },
      },
      {
        description: 'Read a document by name (example)',
        parameters: {
          documentType: 'SomeDocumentType',
          name: 'Exact Name',
        },
      },
      {
        description: 'Read a document with specific fields only (example)',
        parameters: {
          documentType: 'SomeDocumentType',
          id: 'DOCUMENT_ID_HERE',
          fields: ['name', 'type', 'img', 'system'],
          withContent: true,
        },
      },
    ];
  }

  /**
   * Get required permissions for this tool
   */
  getRequiredPermissions() {
    return {
      FILES_BROWSE: true,
      DOCUMENT_CREATE: false,
      DOCUMENT_READ: true,
    };
  }
}
