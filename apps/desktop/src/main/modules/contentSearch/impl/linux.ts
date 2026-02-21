import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import { UnixContentSearch } from './unix';

const logger = createLogger('module:ContentSearch:linux');

/**
 * Linux content search implementation
 * Inherits from UnixContentSearch with Linux-specific optimizations
 */
export class LinuxContentSearchImpl extends UnixContentSearch {
  constructor(toolDetectorManager?: ToolDetectorManager) {
    super(toolDetectorManager);
    logger.debug('LinuxContentSearchImpl initialized');
  }

  /**
   * Get Linux-specific ignore patterns
   */
  protected override getDefaultIgnorePatterns(): string[] {
    return [...super.getDefaultIgnorePatterns(), '**/.cache/**', '**/snap/**'];
  }
}
