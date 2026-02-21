import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import { FileResult, SearchOptions } from '../types';
import { UnixFileSearch, UnixSearchTool } from './unix';

const logger = createLogger('module:FileSearch:linux');

/**
 * Linux file search implementation
 * Uses fd > find > fast-glob fallback strategy
 */
export class LinuxSearchServiceImpl extends UnixFileSearch {
  constructor(toolDetectorManager?: ToolDetectorManager) {
    super(toolDetectorManager);
  }

  /**
   * Perform file search
   * @param options Search options
   * @returns Promise of search result list
   */
  async search(options: SearchOptions): Promise<FileResult[]> {
    // Determine the best available tool on first search
    if (this.currentTool === null) {
      this.currentTool = await this.determineBestUnixTool();
      logger.info(`Using file search tool: ${this.currentTool}`);
    }

    return this.searchWithUnixTool(this.currentTool as UnixSearchTool, options);
  }

  /**
   * Check search service status
   * @returns Promise indicating if service is available (always true for Linux)
   */
  async checkSearchServiceStatus(): Promise<boolean> {
    // At minimum, fast-glob is always available
    return true;
  }

  /**
   * Update search index
   * Linux doesn't have a system-wide search index like Spotlight
   * @returns Promise indicating operation result (always false for Linux)
   */
  async updateSearchIndex(): Promise<boolean> {
    logger.warn('updateSearchIndex is not supported on Linux (no system-wide index)');
    return false;
  }
}
