/**
 * Reference Resolve Tool - deterministic reference/provenance lookup
 */

import { BaseTool } from './base-tool.js';
import { referenceIndexService } from '../core/reference-index-service.js';

class ReferenceResolveTool extends BaseTool {
  constructor() {
    super(
      'resolve_reference',
      'Resolve named Foundry content mechanically using the reference index. Use this before broad document or asset searches when the user names content or a source/book. Returns compact UUID, provenance, portrait, and token metadata without reading or modifying the document.',
      {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'Natural reference text, e.g. "Goblin Warrior from the D&D Monster Manual".',
          },
          documentType: {
            type: 'string',
            description:
              'Optional Foundry document class constraint such as Actor, Item, JournalEntry, or Scene.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            default: 10,
            description: 'Maximum number of ranked references to return.',
          },
        },
        required: ['text'],
      }
    );
  }

  async execute(params) {
    try {
      if (!referenceIndexService.built) {
        await referenceIndexService.rebuild();
      }

      const result = referenceIndexService.resolveTextCompact({
        text: params.text,
        documentType: params.documentType,
        limit: params.limit ?? 10,
      });

      const count = result.matches.length;
      const display =
        count === 0
          ? `No references resolved for "${params.text}"`
          : `Resolved ${count} reference${count === 1 ? '' : 's'} for "${params.text}"`;

      return {
        content: JSON.stringify(result, null, 2),
        display,
      };
    } catch (error) {
      return this.handleError(
        `Failed to resolve reference: ${error.message}`,
        'REFERENCE_RESOLUTION_FAILED'
      );
    }
  }
}

export { ReferenceResolveTool };
