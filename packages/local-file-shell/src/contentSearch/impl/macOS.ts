import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import { UnixContentSearch } from './unix';

const logger = createLogger('contentSearch:macOS');

/**
 * macOS content search implementation
 * Inherits from UnixContentSearch with macOS-specific optimizations
 */
export class MacOSContentSearchImpl extends UnixContentSearch {
  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
    logger.debug('MacOSContentSearchImpl initialized');
  }

  protected override getDefaultIgnorePatterns(): string[] {
    return [
      ...super.getDefaultIgnorePatterns(),
      '**/Library/Caches/**',
      '**/.cache/**',
      '**/snap/**',
    ];
  }
}
