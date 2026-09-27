import { BaseTool } from './base-tool.js';
import { isToolResultSuccess } from '../utils/tool-result-status.js';

export class DocumentMoveTool extends BaseTool {
  constructor() {
    super(
      'document_move',
      'Move a document between the world and compendiums. World-to-world moves update the existing document. Cross-location moves copy, then delete; a failed deletion can leave both copies. Embedded locations are unsupported.',
      DocumentMoveTool._buildSchema(),
      true, // requires confirmation
      true  // requires response
    );
  }

  static _getLocationSchema(description) {
    return {
      type: 'object',
      description,
      properties: {
        type: {
          type: 'string',
          enum: ['world', 'compendium', 'embedded'],
          description: 'The type of location.',
        },
        pack: {
          type: 'string',
          description: 'The compendium pack ID (required if type is "compendium").',
        },
        folder: {
          type: 'string',
          description: 'The target folder ID (optional for world/compendium).',
        },
        parentId: {
          type: 'string',
          description: 'The target parent document ID (required if type is "embedded").',
        },
        parentType: {
          type: 'string',
          description: 'The type of the target parent document (required if type is "embedded").',
        },
      },
      required: ['type'],
    };
  }

  static _buildSchema() {
    return {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          description: 'The document type (e.g., "Actor", "Item", "JournalEntry").',
        },
        sourceId: {
          type: 'string',
          description: 'The ID of the document to move.',
        },
        sourceLocation: DocumentMoveTool._getLocationSchema('The current location of the source document.'),
        targetLocation: DocumentMoveTool._getLocationSchema('The destination for the moved document.'),
        newName: {
          type: 'string',
          description: 'Optional new name for the moved document.',
        },
      },
      required: ['documentType', 'sourceId', 'sourceLocation', 'targetLocation'],
    };
  }

  async execute(args) {
    if (!this.documentAPI) {
      throw new Error('DocumentAPI not available to Tool');
    }

    const { documentType, sourceId, sourceLocation, targetLocation, newName } = args;

    if (sourceLocation?.type === 'embedded' || targetLocation?.type === 'embedded') {
      return this.handleError('Embedded moves are unsupported: a reliable destination identity and source deletion cannot be guaranteed.', 'UNSUPPORTED_LOCATION');
    }
    if (!['world', 'compendium'].includes(sourceLocation?.type) ||
        !['world', 'compendium'].includes(targetLocation?.type)) {
      return this.handleError('Unsupported source or destination location.', 'UNSUPPORTED_LOCATION');
    }
    if (sourceLocation.type === 'compendium') {
      const sourcePack = sourceLocation.pack && game.packs.get(sourceLocation.pack);
      if (!sourcePack || sourcePack.locked) {
        return this.handleError('Source pack is unavailable or locked; no copy was made.', 'SOURCE_UNAVAILABLE');
      }
    }

    if (sourceLocation.type === 'world' && targetLocation.type === 'world') {
      return this._handleWorldFolderMove(documentType, sourceId, targetLocation, newName);
    }

    const { toolRegistry } = await import('../core/tool-registry.js');
    const copyTool = toolRegistry.getTool('document_copy');
    if (!copyTool) {
       return this.handleError('Internal Error: document_copy tool not found.');
    }

    let copyResult;
    try {
      copyResult = await copyTool.execute(args);
      if (!isToolResultSuccess(copyResult)) {
        const copyError = copyResult?.error?.message || copyResult?.error || copyResult?.content || 'Copy did not complete';
        const failure = this.handleError(`Copy phase failed: ${copyError}`, copyResult?.error?.type || 'Error');
        if (copyResult?.partial) failure.partial = copyResult.partial;
        return failure;
      }

      const copied = copyResult.document;
      if (!copied?.id || copied.documentType !== documentType ||
          copied.destination?.type !== targetLocation.type ||
          copied.destination?.pack !== targetLocation.pack ||
          copied.destination?.folder !== targetLocation.folder) {
        const failure = this.handleError('Copy returned no matching destination identity. Check the destination before retrying; source was not deleted.', 'UNKNOWN_DESTINATION');
        failure.partial = { copyCompleted: true, destination: targetLocation, sourceState: 'unchanged' };
        return failure;
      }

      await this._deleteOriginal(documentType, sourceId, sourceLocation);

      return this.createSuccessResponse(
        JSON.stringify({ message: `Successfully moved ${documentType}`, newId: copied.id, destination: targetLocation }),
        `<p>Moved <strong>${copied.name || copied.id}</strong> successfully.</p>`
      );
    } catch (e) {
      if (isToolResultSuccess(copyResult)) {
        const failure = this.handleError(
          `Copy completed, but move failed: ${e.message}. Check source and destination before retrying.`,
          e.constructor.name
        );
        failure.partial = {
          copyCompleted: true,
          destination: targetLocation,
          document: copyResult.document,
          sourceState: 'unknown',
        };
        return failure;
      }
      return this.handleError(`Move failed: ${e.message}`, e.constructor.name);
    }
  }

  async _handleWorldFolderMove(documentType, sourceId, targetLocation, newName) {
    try {
      const updates = {};
      if (newName) updates.name = newName;
      if (targetLocation.folder !== undefined) updates.folder = targetLocation.folder;
      
      if (Object.keys(updates).length > 0) {
          const updatedDoc = await this.documentAPI.updateDocument(
            documentType, 
            sourceId, 
            updates
          );
          return this.createSuccessResponse(
            `{ "message": "Moved ${documentType}", "id": "${updatedDoc._id}" }`,
            `<p>Moved <strong>${updatedDoc.name || 'document'}</strong></p>`
          );
      }
      return this.createSuccessResponse(
        `{ "message": "No changes made to ${documentType}" }`,
        `<p>No changes needed.</p>`
      );
    } catch(e) {
      return this.handleError(`Failed to move world document: ${e.message}`, e.constructor.name);
    }
  }

  async _deleteOriginal(documentType, sourceId, location) {
    if (location.type === 'world') {
      await this.documentAPI.deleteDocument(documentType, sourceId);
    } else if (location.type === 'compendium') {
      const packCollection = game.packs.get(location.pack);
      if (!packCollection) throw new Error(`Source pack not found: ${location.pack}`);
      if (packCollection.locked) throw new Error(`Source pack is locked: ${location.pack}`);
      const doc = await packCollection.getDocument(sourceId);
      if (!doc) throw new Error(`Source document not found in pack: ${sourceId}`);
      await doc.delete();
    } else if (location.type === 'embedded') {
      await this.documentAPI.applyEmbeddedOperations(location.parentType, location.parentId, [{
         embeddedName: documentType,
         action: 'delete',
         targetId: sourceId
      }]);
    }
  }

}
