/* eslint-disable no-console, camelcase */
/**
 * Read Tool Output - Provides indexed access to large tool outputs
 * Part of the Context Compaction feature
 */

import { BaseTool } from './base-tool.js';
import { SimulacrumCore } from '../core/simulacrum-core.js';

/**
 * Tool for reading portions of previously stored tool outputs
 * Enables the AI to access large outputs without bloating context
 */
export class ReadToolOutputTool extends BaseTool {
  constructor() {
    super(
      'read_tool_output',
      'Read a bounded portion of a retained tool output by line range or character range. Only recent output is kept; large outputs may be truncated in storage. Use character ranges for a long single line.',
      null,
      false
    );
  }

  /**
   * Get parameter schema for the tool
   * @returns {Object} Parameter schema definition
   */
  getParameterSchema() {
    return this._addResponseParam({
      type: 'object',
      properties: {
        tool_call_id: {
          type: 'string',
          description:
            'The ID of the tool call whose stored output to read. This ID is provided in the compacted reference when output exceeds the context window.',
        },
        start_line: {
          type: 'integer',
          description:
            'Starting line (1-indexed). Supply with end_line, or use start_char/end_char instead.',
        },
        end_line: {
          type: 'integer',
          description:
            'Inclusive ending line (1-indexed). Use with start_line.',
        },
        start_char: { type: 'integer', minimum: 1, description: 'Optional 1-indexed start character for long single-line output.' },
        end_char: { type: 'integer', minimum: 1, description: 'Optional inclusive end character. Use with start_char, at most 10000 characters.' },
      },
      required: ['tool_call_id'],
    });
  }

  /**
   * Execute the tool
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Result of the tool execution
   */
  async execute(params) {
    const { tool_call_id, start_line, end_line, start_char, end_char } = params;

    // Validate parameters
    if (!tool_call_id || typeof tool_call_id !== 'string') {
      return this.handleError('tool_call_id is required and must be a string', 'ValidationError');
    }

    const charMode = start_char !== undefined || end_char !== undefined;
    if (charMode && (!Number.isInteger(start_char) || start_char < 1 || !Number.isInteger(end_char) ||
        end_char < start_char || end_char - start_char + 1 > 10000)) {
      return this.handleError('Character range must be positive, ascending, and at most 10000 characters', 'ValidationError');
    }
    if (!charMode && (!Number.isInteger(start_line) || start_line < 1)) {
      return this.handleError('start_line must be a positive integer', 'ValidationError');
    }

    if (!charMode && (!Number.isInteger(end_line) || end_line < start_line)) {
      return this.handleError('end_line must be >= start_line', 'ValidationError');
    }

    // Access the tool output buffer from ConversationManager
    const buffer = SimulacrumCore.conversationManager?.toolOutputBuffer;

    if (!buffer) {
      return this.handleError('Tool output buffer not available', 'Error');
    }

    if (!buffer.has(tool_call_id)) {
      return this.handleError(
        `No stored output for tool call: ${tool_call_id}. The output may have expired or the ID is incorrect.`,
        'NotFoundError'
      );
    }

    const fullOutput = buffer.get(tool_call_id);
    if (charMode) {
      if (start_char > fullOutput.length) return this.handleError('start_char exceeds retained output length', 'ValidationError');
      const end = Math.min(end_char, fullOutput.length);
      return {
        success: true, content: fullOutput.slice(start_char - 1, end),
        display: `Reading characters ${start_char}-${end} of ${fullOutput.length} retained characters`,
        showing: `${start_char}-${end}`, has_more: end < fullOutput.length,
      };
    }
    const lines = fullOutput.split('\n');
    const totalLines = lines.length;
    if (start_line > totalLines) return this.handleError('start_line exceeds retained output lines', 'ValidationError');

    // Clamp end_line to actual line count
    const effectiveEndLine = Math.min(end_line, totalLines);
    const slice = lines.slice(start_line - 1, effectiveEndLine);

    // Limit output size to prevent context overflow
    const MAX_OUTPUT_CHARS = 10000;
    let content = slice.join('\n');
    let wasTruncated = false;

    if (content.length > MAX_OUTPUT_CHARS) {
      content = content.substring(0, MAX_OUTPUT_CHARS);
      wasTruncated = true;
    }

    const displayText = `Reading lines ${start_line}-${effectiveEndLine} of ${totalLines}${wasTruncated ? ' (truncated)' : ''}`;

    return {
      success: true,
      content: content,
      display: displayText,
      total_lines: totalLines,
      showing: `${start_line}-${effectiveEndLine}`,
      has_more: effectiveEndLine < totalLines,
      truncated: wasTruncated
        ? `Output truncated at ${MAX_OUTPUT_CHARS} chars. Request smaller line ranges or use start_char/end_char for a long line.`
        : undefined,
    };
  }
}
