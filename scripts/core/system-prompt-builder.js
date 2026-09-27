/* eslint-disable complexity, max-lines-per-function, no-console */
/**
 * System Prompt Builder - Generates system prompts for AI conversations
 * Extracted from SimulacrumCore to reduce god class responsibilities
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('SystemPrompt');

/**
 * Get document types information for the system prompt
 * @returns {string} Formatted document types info
 */
export function getDocumentTypesInfo() {
  try {
    const documentTypes = Object.keys(game?.documentTypes || {}).filter(type => {
      const collection = game?.collections?.get(type);
      return collection !== undefined;
    });

    if (documentTypes.length === 0) {
      return 'No document types available in current system.';
    }

    const typeDetails = documentTypes.map(type => {
      const subtypes = game.documentTypes[type] || [];
      if (subtypes.length > 0) {
        return `${type}: [${subtypes.join(', ')}]`;
      }
      return type;
    });

    return `Available document types: ${typeDetails.join(', ')}.`;
  } catch (error) {
    return 'Document type information unavailable.';
  }
}

/**
 * Get formatted list of available macros (World + Module)
 * @returns {Promise<string>} Formatted list of macros
 */
export async function getAvailableMacrosList() {
  const macros = [];

  // 1. World Macros
  game.macros.forEach(m => {
    macros.push(`- "${m.name}" (UUID: ${m.uuid})`);
  });

  // 2. Simulacrum Module Macros
  const pack = game.packs.get('simulacrum.simulacrum-tools');
  if (pack) {
    const index = await pack.getIndex();
    index.forEach(i => {
      macros.push(`- "${i.name}" (UUID: ${i.uuid})`);
    });
  }

  if (macros.length === 0) return 'No macros available.';
  return macros.join('\n');
}

/**
 * Build the complete system prompt
 * @returns {Promise<string>} The system prompt
 */
export async function buildSystemPrompt({ tools = [] } = {}) {
  const legacyMode = game?.settings?.get('simulacrum', 'legacyMode') || false;
  const customSystemPrompt = game?.settings?.get('simulacrum', 'customSystemPrompt') || '';
  const scopedTools = Array.isArray(tools) ? tools : [];
  const instructions = [
    game.i18n.localize('SIMULACRUM.SystemPrompt.Standard.Identity'),
    'Use only tools offered for this request. Answer directly when no tool is needed. Read existing documents before updating or deleting them. Report only actions and results actually observed; say when work failed or needs clarification. A plain-language final answer ends the turn.',
  ];
  if (legacyMode) {
    instructions.push(scopedTools.length
      ? `To call an offered tool, use a JSON block: {"tool_call":{"name":"tool_name","arguments":{}}}. Available tool schemas: ${JSON.stringify(scopedTools)}`
      : 'No tools are available for this request. Respond in plain language.');
  }
  let basePrompt = instructions.join('\n\n');

  // Append custom system prompt if provided
  if (customSystemPrompt && customSystemPrompt.trim().length > 0) {
    const customInstructions = game.i18n.format('SIMULACRUM.SystemPrompt.CustomInstructions', {
      customPrompt: customSystemPrompt.trim(),
    });
    basePrompt = basePrompt + '\n\n' + customInstructions;
  }

  // Security check: verify no HTML tags exist in the prompt (logged only in debug mode)
  if (globalThis.CONFIG?.debug?.simulacrum) {
    const tagRegex = /<\/?[a-z][a-z0-9]*\b[^>]*>/gi;
    const foundTags = basePrompt.match(tagRegex) || [];
    const isClean = foundTags.length === 0;

    logger.debug('System Prompt Verification');
    logger.debug(`Content Length: ${basePrompt.length}`);
    if (isClean) {
      logger.debug('Security Check: PASS (No forbidden HTML tags found)');
    } else {
      logger.error(
        `Security Check: FAIL (Found tags: ${foundTags.slice(0, 10).join(', ')}${foundTags.length > 10 ? '...' : ''})`
      );
      logger.warn('The presence of ANY HTML tags may trigger the API WAF.');
    }
  }

  return basePrompt;
}
