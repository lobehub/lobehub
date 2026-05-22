import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import { UnixContentSearch } from './unix';

const logger = createLogger('contentSearch:linux');

/**
 * Linux content search implementation
 * Inherits from UnixContentSearch with Linux-specific optimizations
 */
export class LinuxContentSearchImpl extends UnixContentSearch {
  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
    logger.debug('LinuxContentSearchImpl initialized');
  }

  protected override getDefaultIgnorePatterns(): string[] {
    return [...super.getDefaultIgnorePatterns(), '**/.cache/**', '**/snap/**'];
  }
}
