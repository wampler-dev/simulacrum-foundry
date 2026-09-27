/**
 * Compatibility surface for the module API while automatic macro-tool discovery
 * is disabled. Macro source must never be evaluated to discover configuration.
 * See C1/C2 in docs/stabilization-development-plan.md before restoring discovery.
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MacroToolManager');

export class MacroToolManager {
  async initialize() {
    logger.info('Automatic macro-tool discovery is disabled during stabilization.');
  }

  /** Retained for API callers; does not scan documents or register tools. */
  async refreshTools() {}

  getTools() {
    return [];
  }

  getToolSchemas() {
    return [];
  }
}
