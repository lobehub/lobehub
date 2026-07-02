import {
  type BaseFileSearch,
  createFileSearchModule,
  type FileResult,
  type GlobFilesParams,
  type GlobFilesResult,
  type SearchOptions,
} from '@lobechat/local-file-shell';

import { ServiceModule } from './index';

/**
 * File Search Service
 * Main service class that delegates to platform-specific implementations from
 * `@lobechat/local-file-shell`.
 */
export default class FileSearchService extends ServiceModule {
  private impl: BaseFileSearch = createFileSearchModule();

  async search(
    query: string,
    options: Omit<SearchOptions, 'keywords'> = {},
  ): Promise<FileResult[]> {
    if (this.app?.binaryManager) {
      this.impl.setToolDetector(this.app.binaryManager);
    }
    return this.impl.search({ ...options, keywords: query });
  }

  async checkSearchServiceStatus(): Promise<boolean> {
    return this.impl.checkSearchServiceStatus();
  }

  async updateSearchIndex(path?: string): Promise<boolean> {
    return this.impl.updateSearchIndex(path);
  }

  async glob(params: GlobFilesParams): Promise<GlobFilesResult> {
    if (this.app?.binaryManager) {
      this.impl.setToolDetector(this.app.binaryManager);
    }
    return this.impl.glob(params);
  }
}
