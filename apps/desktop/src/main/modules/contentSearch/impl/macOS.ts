import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import { UnixContentSearch } from './unix';

const logger = createLogger('module:ContentSearch:macOS');

/**
 * macOS content search implementation
 * Inherits from UnixContentSearch with macOS-specific optimizations
 */
export class MacOSContentSearchImpl extends UnixContentSearch {
  constructor(toolDetectorManager?: ToolDetectorManager) {
    super(toolDetectorManager);
    logger.debug('MacOSContentSearchImpl initialized');
  }

  /**
   * Get macOS-specific ignore patterns
   * Includes Library/Caches which is specific to macOS
   */
  protected override getDefaultIgnorePatterns(): string[] {
    return [
      ...super.getDefaultIgnorePatterns(),
      '**/Library/Caches/**',
      '**/.cache/**',
      '**/snap/**',
    ];
  }
}
