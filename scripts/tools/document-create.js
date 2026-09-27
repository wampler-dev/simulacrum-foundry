/**
 * Document Creation Tool
 * Creates new documents within FoundryVTT using the Document API
 */

import { BaseTool } from './base-tool.js';
import { ValidationErrorHandler } from '../utils/validation-errors.js';
import { documentReadRegistry } from '../utils/document-read-registry.js';

/**
 * Validation schema for document creation parameters
 * Currently handled by validateParams method
 */
// const createDocumentSchema = {
//   type: 'object',
//   required: ['documentType', 'name'],

/**
 * Document Creation Tool
 */
export class DocumentCreateTool extends BaseTool {
  constructor() {
    super(
      'create_document',
      "Create a new document in the world or a compendium pack. The `data` parameter contains document fields such as `name`, `type`, and system-specific fields under `system`. Use `inspect_document_schema` when field structure is uncertain; use `list_document_schemas` when the type or subtype is unknown. Invalid fields receive targeted correction. Pass `documentType` as \"Compendium\" to create a world pack (requires `data.name`, `data.label`, and `data.type`)."
    );
    this.requiresConfirmation = true;
    this.schema = {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          description:
            'The document class to create (e.g., Actor, Item, JournalEntry, RollTable, Scene). Use `list_document_schemas` to discover available types.',
        },
        data: {
          type: 'object',
          description:
            'The document\'s field data as a JSON object. Include `name` and, for typed documents, `type` (e.g., "npc", "weapon"). Inspect uncertain system or embedded fields; embedded documents use arrays such as JournalEntry `pages` or Actor `items`.',
        },
        folder: {
          type: 'string',
          description:
            'The ID of an existing Folder to place the document in. Omit to create at root level.',
        },
        pack: {
          type: 'string',
          description:
            'The compendium pack ID to create the document in (e.g., "dnd5e.items"). The pack must be unlocked and match the document type. Omit to create in the world.',
        },
      },
      required: ['documentType', 'data'],
    };
  }

  /**
   * Get the parameter schema for this tool
   */
  getParameterSchema() {
    return this._addResponseParam(this.schema);
  }

  /**
   * Get confirmation details for this tool
   */
  async getConfirmationDetails(params) {
    const { documentType, data } = params;

    // Mock DocumentAPI call (would be real in actual implementation)
    const mockSchema = { fields: ['name', 'type'], systemFields: ['attributes'] };

    return {
      type: 'create',
      title: `Create ${documentType} Document`,
      details: `Creating ${documentType}: ${data.name || 'Unnamed'}`,
      availableFields: mockSchema.fields,
      systemFields: mockSchema.systemFields,
    };
  }

  /**
   * Create a new world compendium pack
   * @param {Object} params - Tool parameters with data.name, data.label, data.type
   * @returns {Promise<Object>} Creation result
   */
  async _createCompendium(params) {
    const { data } = params;

    if (!game.user?.isGM) {
      return {
        content: 'Only GMs can create compendium packs',
        display: 'Permission denied: GM required',
        error: { message: 'Only GMs can create compendium packs', type: 'PERMISSION_DENIED' },
      };
    }

    if (!data?.name || !data?.label || !data?.type) {
      return {
        content:
          'Creating a Compendium requires `data.name` (lowercase pack name with hyphens), `data.label` (display name), and `data.type` (document type the pack stores, e.g. Actor, Item, JournalEntry).',
        display: 'Missing required fields for compendium creation',
        error: { message: 'Missing name, label, or type', type: 'VALIDATION_ERROR' },
      };
    }

    const fullPackId = data.name.includes('.') ? data.name : `world.${data.name}`;
    if (game.packs.has(fullPackId)) {
      return {
        content: `Compendium pack "${fullPackId}" already exists`,
        display: `Pack already exists: ${fullPackId}`,
        error: { message: `Pack "${fullPackId}" already exists`, type: 'CONFLICT' },
      };
    }

    try {
      const packName = data.name.includes('.') ? data.name.split('.')[1] : data.name;
      const newPack = await CompendiumCollection.createCompendium({
        name: packName,
        label: data.label,
        type: data.type,
        packageType: 'world',
      });

      const packId = newPack.metadata.id;
      const msg = `Created compendium pack "${newPack.metadata.label}" (${packId}) for ${data.type} documents`;
      return {
        content: JSON.stringify({ message: msg, packId, metadata: newPack.metadata }, null, 2),
        display: `Created compendium **${newPack.metadata.label}** (${packId})`,
      };
    } catch (error) {
      return {
        content: `Failed to create compendium: ${error.message}`,
        display: `Compendium creation failed: ${error.message}`,
        error: { message: error.message, type: 'CREATE_FAILED' },
      };
    }
  }

  async _promoteSystemFields(documentType, data) {
    try {
      const { DocumentAPI } = await import('../core/document-api.js');
      const schema = DocumentAPI.getDocumentSchema(documentType);

      if (!schema?.systemFields || !Array.isArray(schema.systemFields)) return;

      if (!data.system) data.system = {};

      for (const field of schema.systemFields) {
        this._migrateField(data, field, schema);
      }
    } catch (migrationError) {
      // Ignoring migration errors
    }
  }

  _migrateField(data, field, schema) {
    // Skip if field not at root or already in system
    if (data[field] === undefined || data.system[field] !== undefined) return;

    const targetType = schema.systemFieldDetails?.[field]?.type;
    const value = data[field];

    if (typeof value === 'string' && (targetType === 'schema_field' || targetType === 'object')) {
      data.system[field] = { value: value };
    } else {
      data.system[field] = value;
    }

    delete data[field];
  }

  /**
   * Execute document creation
   * @param {Object} parameters - Creation parameters
   * @returns {Promise<Object>} Creation result
   */
  async execute(parameters) {
    try {
      const { documentType, data } = parameters;

      // Compendium creation branch — early return before normal document flow
      if (documentType === 'Compendium') {
        return this._createCompendium(parameters);
      }

      // Check if document type is valid
      if (!this.isValidDocumentType(documentType)) {
        return {
          content: `Document type "${documentType}" not available in current system`,
          display: `Unknown document type: ${documentType}`,
          error: {
            message: `Document type "${documentType}" not available in current system`,
            type: 'UNKNOWN_DOCUMENT_TYPE',
          },
        };
      }

      // Validate parameters
      this.validateParameters(parameters, this.schema);

      // Validate unknown fields - catch fields that would be silently ignored
      const { SchemaValidator } = await import('../utils/schema-validator.js');
      const unknownFieldsResult = SchemaValidator.validateUnknownFields(documentType, data);
      if (!unknownFieldsResult.valid && unknownFieldsResult.unknownFields.length > 0) {
        const available = unknownFieldsResult.availableFields || [];
        const priority = ['name', 'type', 'system'];
        const validFields = [...priority.filter(field => available.includes(field)),
          ...available.filter(field => !priority.includes(field))].slice(0, 20);
        const specificHints = unknownFieldsResult.suggestions.filter(suggestion =>
          !suggestion.startsWith('Unknown fields will be ignored:') &&
          !suggestion.startsWith('Valid top-level fields for ')).slice(0, 5);
        const message = `Creation rejected: unknown top-level fields: ${unknownFieldsResult.unknownFields.join(', ')}. ` +
          `Valid top-level fields include: ${validFields.join(', ') || 'none'}` +
          (available.length > validFields.length ? ` (${available.length - validFields.length} more; inspect_document_schema for details).` : '.') +
          (specificHints.length ? ` Hints: ${specificHints.join(' ')}` : ' Use inspect_document_schema for nested or subtype fields.');

        return {
          content: message,
          display: `Unknown fields: ${unknownFieldsResult.unknownFields.join(', ')}`,
          error: {
            message: `Unknown top-level fields: ${unknownFieldsResult.unknownFields.join(', ')}`,
            type: 'UNKNOWN_FIELDS',
            unknownFields: unknownFieldsResult.unknownFields,
          },
        };
      }

      // Generic Schema Migration (String -> Object promotion)
      await this._promoteSystemFields(documentType, data);

      // Validate image URLs — invalid ones are blanked, not rejected
      const imageWarnings = await this.validateImageUrls(data);

      // Correct malformed UUIDs using schema-derived reference fields
      const uuidWarnings = this.validateUuids(documentType, data, parameters.pack);

      // Mock DocumentAPI for testing - in real implementation, this would use this.documentAPI
      const { DocumentAPI } = await import('../core/document-api.js');

      // RESHAPE DATA: Transform AI-friendly arrays into Foundry-required objects (e.g., MappingField)
      const documentClass = CONFIG[documentType]?.documentClass;
      if (documentClass) {
        this.#reshapeData(data, documentClass, data.type);
      }

      let document;
      if (parameters.pack) {
        const packCollection = game.packs.get(parameters.pack);
        if (!packCollection) {
          return {
            content: `Compendium pack "${parameters.pack}" not found`,
            display: `Pack not found: ${parameters.pack}`,
            error: { message: `pack "${parameters.pack}" not found`, type: 'PACK_NOT_FOUND' },
          };
        }

        // Check if pack is locked
        if (packCollection.locked) {
          return {
            content: `Compendium pack "${parameters.pack}" is locked. Cannot create document.`,
            display: `Pack is locked: ${parameters.pack}`,
            error: { message: `pack "${parameters.pack}" is locked`, type: 'PACK_LOCKED' },
          };
        }

        // Validate document type against pack type
        if (packCollection.documentName !== documentType) {
          return {
            content: `Pack "${parameters.pack}" contains ${packCollection.documentName} documents, but you requested ${documentType}`,
            display: `Type mismatch: Pack contains ${packCollection.documentName}`,
            error: { message: `Type mismatch`, type: 'TYPE_MISMATCH' },
          };
        }

        // Create directly in pack - wrap in try/catch to capture validation errors
        // that Foundry might throw during creation
        try {
          document = await documentClass.create(data, { pack: parameters.pack });
        } catch (packCreateError) {
          // Re-throw to be handled by the outer catch block with ValidationErrorHandler
          throw packCreateError;
        }
      } else {
        document = await DocumentAPI.createDocument(documentType, data);
      }

      if (!document) {
        // Foundry sometimes returns null/undefined on validation failure instead of throwing
        // This can happen when strict validation fails during document instantiation
        // Try to provide more context by attempting a validation
        try {
          const testDoc = new documentClass(data);
          testDoc.validate({ strict: true, fields: true, joint: true });
        } catch (validationError) {
          // Found the actual error - rethrow to be handled by ValidationErrorHandler
          throw validationError;
        }
        // If validation passes but still got null, return generic error
        return {
          content: `Document creation failed. The document could not be created. Check that all required fields are provided and all values are valid for the ${documentType} document type.`,
          display: `Failed to create ${documentType} document`,
          error: {
            message: 'Document creation failed - no document returned',
            type: 'CREATE_FAILED',
            hint: 'Check browser console for additional Foundry validation errors',
          },
        };
      }

      // Fetch the full document with embedded data for verification
      // IMPORTANT: Pass pack parameter so we look in the right place!
      const verificationOpts = { includeEmbedded: true };
      if (parameters.pack) verificationOpts.pack = parameters.pack;

      const fullDocument = await DocumentAPI.getDocument(
        documentType,
        document.id || document._id,
        verificationOpts
      );

      // Register the read so the AI can immediately edit it if needed
      if (fullDocument) {
        documentReadRegistry.registerRead(
          documentType,
          fullDocument.id || fullDocument._id,
          fullDocument,
          parameters.pack
        );
      }

      const message = `Created @UUID[${documentType}.${fullDocument._id || fullDocument.id}]{${fullDocument.name || fullDocument._id}}`;
      const contentPayload = {
        message,
        document: fullDocument,
      };
      const allWarnings = [...imageWarnings, ...uuidWarnings];
      if (allWarnings.length > 0) {
        contentPayload.warnings = allWarnings;
      }

      return {
        content: JSON.stringify(contentPayload, null, 2),
        display: `Created **${fullDocument.name || fullDocument._id || fullDocument.id}** (${documentType})`,
        document: fullDocument,
      };
    } catch (error) {
      // Attempt to auto-correct invalid document ID fields and retry once
      try {
        const retryResult = await this.#retryWithCorrectedIds(error, parameters);
        if (retryResult) return retryResult;
      } catch {
        // Retry also failed — fall through to original error response
      }
      return ValidationErrorHandler.createToolErrorResponse(
        error,
        'create',
        parameters.documentType
      );
    }
  }

  /**
   * Reshape data to match Foundry's strict DataModel expectations.
   * Specifically transforms Arrays -> ID-keyed Objects for MappingFields.
   * @param {Object} data - The data object to reshape (modified in place)
   * @param {Class} documentClass - The DataModel class
   * @param {String} [documentSubType] - The sub-type (e.g., 'weapon') for system data lookup
   */
  #reshapeData(data, documentClass, documentSubType) {
    if (!data || typeof data !== 'object') return;

    // 1. Get the relevant schema
    // If we are looking at 'system' data, we need the type-specific model
    const schema = documentClass.schema;

    // Attempt to handle system data reshaping
    if (data.system && typeof data.system === 'object') {
      try {
        const systemModel = CONFIG[documentClass.documentName]?.dataModels?.[documentSubType];
        if (systemModel && systemModel.schema) {
          this.#reshapeDataFields(data.system, systemModel.schema);
        } else if (documentClass.schema?.fields?.system?.model?.schema) {
          // Some systems handle it differently, simplified fallback
          this.#reshapeDataFields(data.system, documentClass.schema.fields.system.model.schema);
        }
      } catch (e) {
        // Ignore system lookup errors
      }
    }

    // 2. Reshape top-level fields
    // (Note: Top level fields on Documents are rarely MappingFields, but good for completeness)
    if (schema) {
      this.#reshapeDataFields(data, schema);
    }
  }

  /**
   * Recursive field processor for #reshapeData
   * @param {Object} dataObject - The object containing data properties
   * @param {Schema} schema - The schema defining those properties
   */
  #reshapeDataFields(dataObject, schema) {
    if (!schema?.fields) return;

    for (const [fieldName, value] of Object.entries(dataObject)) {
      if (!value) continue;
      const field = schema.fields[fieldName];
      if (!field) continue;

      // CHECK: Array provided for a MappingField?
      // MappingFields (like system.activities in dnd5e) require ID-keyed objects
      if (Array.isArray(value)) {
        // USE HELPER: Check full prototype chain for MappingField ancestry
        // (Fixes issue where 'ActivitiesField' subclass was not detected)
        if (this.#isMappingField(field)) {
          // TRANSFORM: Array -> Object with random IDs
          const obj = {};
          value.forEach(item => {
            // Use standard randomID if available, else simple fallback
            const id =
              typeof foundry !== 'undefined'
                ? foundry.utils.randomID()
                : Math.random().toString(36).substring(2, 18);
            obj[id] = item;

            // Recurse into the item if it has its own schema (e.g. Activity DataModel)
            if (field.model?.schema) {
              this.#reshapeDataFields(item, field.model.schema);
            }
          });
          dataObject[fieldName] = obj;
          continue; // Done with this field
        }
      }

      // Recurse for nested objects (SchemaField)
      if (
        field.constructor.name === 'SchemaField' &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        this.#reshapeDataFields(value, field); // SchemaField acts as schema
      }
    }
  }

  /**
   * Helper to identify MappingField instances by checking prototype chain.
   * Handles subclasses like ActivitiesField.
   * @param {DataField} field
   * @returns {boolean}
   */
  #isMappingField(field) {
    if (!field) return false;

    // Check direct constructor
    if (field.constructor.name === 'MappingField') return true;

    // Walk prototype chain to check for inheritance
    let proto = Object.getPrototypeOf(field);
    while (proto) {
      if (proto.constructor?.name === 'MappingField') return true;
      proto = Object.getPrototypeOf(proto);
    }

    return false;
  }

  /**
   * Attempt to fix invalid document ID fields detected by Foundry validation and retry creation.
   * Foundry requires ID fields to match /^[a-zA-Z0-9]{16}$/. When the AI provides invalid IDs
   * (e.g. a folder name instead of a folder ID), we detect the validation error, correct the
   * fields, and retry the creation — reporting what was auto-corrected.
   * @param {Error} error - The original validation error from Foundry
   * @param {Object} parameters - The tool parameters (data is mutated in place)
   * @returns {Promise<Object|null>} Success response with warnings, or null if not an ID error
   */
  async #retryWithCorrectedIds(error, parameters) {
    const parsed = ValidationErrorHandler.parseFoundryValidationError(error);
    if (!parsed) return null;

    const ID_ERROR = '16-character alphanumeric';
    const corrections = [];

    for (const [fieldPath, detail] of Object.entries(parsed.details)) {
      if (!detail.error?.includes(ID_ERROR)) continue;

      const originalValue = this.#getFieldValue(parameters.data, fieldPath);
      let correctedValue;

      if (fieldPath === 'folder' || fieldPath.endsWith('.folder')) {
        // For folder fields: try to resolve by name, otherwise null (root level)
        correctedValue = this.#resolveFolderByName(originalValue, parameters.documentType);
      } else {
        // For other ID fields: remove and let Foundry auto-generate
        correctedValue = null;
      }

      this.#setFieldValue(parameters.data, fieldPath, correctedValue);
      corrections.push({ field: fieldPath, original: originalValue, corrected: correctedValue });
    }

    if (corrections.length === 0) return null;

    // Retry the creation with corrected data
    const { DocumentAPI } = await import('../core/document-api.js');
    let document;
    if (parameters.pack) {
      const documentClass = CONFIG[parameters.documentType]?.documentClass;
      document = await documentClass.create(parameters.data, { pack: parameters.pack });
    } else {
      document = await DocumentAPI.createDocument(parameters.documentType, parameters.data);
    }

    if (!document) return null;

    // Verify the created document
    const verificationOpts = { includeEmbedded: true };
    if (parameters.pack) verificationOpts.pack = parameters.pack;

    const fullDocument = await DocumentAPI.getDocument(
      parameters.documentType,
      document.id || document._id,
      verificationOpts
    );

    if (fullDocument) {
      documentReadRegistry.registerRead(
        parameters.documentType,
        fullDocument.id || fullDocument._id,
        fullDocument,
        parameters.pack
      );
    }

    // Build correction warnings so the AI knows what was changed
    const warnings = corrections.map(c => {
      if (c.corrected === null) {
        return `Auto-corrected "${c.field}": invalid ID "${c.original}" was removed (set to null). Foundry document IDs must be exactly 16 alphanumeric characters.`;
      }
      return `Auto-corrected "${c.field}": invalid value "${c.original}" was resolved to folder ID "${c.corrected}".`;
    });

    const message = `Created @UUID[${parameters.documentType}.${fullDocument._id || fullDocument.id}]{${fullDocument.name || fullDocument._id}}`;
    const contentPayload = { message, document: fullDocument, warnings };

    return {
      content: JSON.stringify(contentPayload, null, 2),
      display: `Created **${fullDocument.name || fullDocument._id || fullDocument.id}** (${parameters.documentType})`,
      document: fullDocument,
    };
  }

  /**
   * Try to resolve a folder by name when an invalid ID was provided.
   * @param {string} value - The invalid folder value (might be a name)
   * @param {string} documentType - The document type to match folder type
   * @returns {string|null} Valid folder ID or null
   */
  #resolveFolderByName(value, documentType) {
    if (!value || typeof value !== 'string') return null;
    try {
      const folder = game.folders?.find(
        f => f.name?.toLowerCase() === value.toLowerCase() && f.type === documentType
      );
      return folder?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get a value from an object by dot-separated field path.
   */
  #getFieldValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Set a value on an object by dot-separated field path.
   */
  #setFieldValue(obj, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    let current = obj;
    for (const part of parts) {
      if (current[part] == null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
    current[last] = value;
  }

  /**
   * Get example usage for this tool
   */
  getExamples() {
    return [
      {
        description: 'Create a new document (example)',
        parameters: {
          documentType: 'SomeDocumentType',
          name: 'Example Name',
          data: {
            content: '<p>Example content</p>',
          },
        },
      },
      {
        description: 'Create a typed document (example)',
        parameters: {
          documentType: 'SomeDocumentType',
          name: 'Example Entity',
          data: {
            type: 'some-type',
            img: 'icons/example.png',
            system: {
              details: { description: 'Example description' },
            },
          },
        },
      },
      {
        description: 'Create a document in a specific folder (example)',
        parameters: {
          documentType: 'SomeDocumentType',
          name: 'Example Object',
          folder: 'Compendium.foundryvtt.content-folder',
          data: {
            type: 'some-type',
            img: 'icons/example.svg',
            system: { uses: { value: 1, max: 1 } },
          },
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
      FILES_UPLOAD: true,
      DOCUMENT_CREATE: true,
      [`ENTITY_CREATE`]: true,
    };
  }
}
