import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import type { FileResult, SearchFilesParams } from '../../types';
import { UnixFileSearch, type UnixSearchTool } from './unix';

const logger = createLogger('fileSearch:linux');

/**
 * Linux file search implementation
 * Uses fd > find > fast-glob fallback strategy
 */
export class LinuxSearchServiceImpl extends UnixFileSearch {
  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
  }

  async search(options: SearchFilesParams): Promise<FileResult[]> {
    if (this.currentTool === null) {
      this.currentTool = await this.determineBestUnixTool();
      logger.info(`Using file search tool: ${this.currentTool}`);
    }

    return this.searchWithUnixTool(this.currentTool as UnixSearchTool, options);
  }

  async checkSearchServiceStatus(): Promise<boolean> {
    return true;
  }

  async updateSearchIndex(): Promise<boolean> {
    logger.warn('updateSearchIndex is not supported on Linux (no system-wide index)');
    return false;
  }
}
