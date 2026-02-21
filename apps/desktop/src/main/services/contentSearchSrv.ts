import { GrepContentParams, GrepContentResult } from '@lobechat/electron-client-ipc';

import { BaseContentSearch, createContentSearchImpl } from '@/modules/contentSearch';

import { ServiceModule } from './index';

/**
 * Content Search Service
 * Provides content search functionality using platform-specific implementations
 */
export default class ContentSearchService extends ServiceModule {
  private impl: BaseContentSearch = createContentSearchImpl();

  /**
   * Perform content search (grep)
   */
  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    // Ensure toolDetectorManager is set
    if (this.app?.toolDetectorManager) {
      this.impl.setToolDetectorManager(this.app.toolDetectorManager);
    }
    return this.impl.grep(params);
  }

  /**
   * Check if a specific tool is available
   */
  async checkToolAvailable(tool: string): Promise<boolean> {
    return this.impl.checkToolAvailable(tool);
  }
}
