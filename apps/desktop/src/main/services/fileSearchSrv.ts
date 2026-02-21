import { GlobFilesParams, GlobFilesResult } from '@lobechat/electron-client-ipc';

import {
  BaseFileSearch,
  FileResult,
  SearchOptions,
  createFileSearchModule,
} from '@/modules/fileSearch';

import { ServiceModule } from './index';

/**
 * File Search Service
 * Main service class that uses platform-specific implementations internally
 */
export default class FileSearchService extends ServiceModule {
  private impl: BaseFileSearch = createFileSearchModule();

  /**
   * Perform file search
   */
  async search(
    query: string,
    options: Omit<SearchOptions, 'keywords'> = {},
  ): Promise<FileResult[]> {
    return this.impl.search({ ...options, keywords: query });
  }

  /**
   * Check search service status
   */
  async checkSearchServiceStatus(): Promise<boolean> {
    return this.impl.checkSearchServiceStatus();
  }

  /**
   * Update search index
   * @param path Optional specified path
   * @returns Promise indicating operation success
   */
  async updateSearchIndex(path?: string): Promise<boolean> {
    return this.impl.updateSearchIndex(path);
  }

  /**
   * Perform glob pattern matching
   * @param params Glob parameters
   * @returns Promise of glob result
   */
  async glob(params: GlobFilesParams): Promise<GlobFilesResult> {
    return this.impl.glob(params);
  }
}
