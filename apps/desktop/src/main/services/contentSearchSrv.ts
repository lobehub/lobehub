import {
  type BaseContentSearch,
  createContentSearchImpl,
  type GrepContentParams,
  type GrepContentResult,
} from '@lobechat/local-file-shell';

import { ServiceModule } from './index';

/**
 * Content Search Service
 * Provides content search functionality using platform-specific implementations
 * sunk into the shared `@lobechat/local-file-shell` package.
 */
export default class ContentSearchService extends ServiceModule {
  private impl: BaseContentSearch = createContentSearchImpl();

  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    // Lazily wire the desktop ToolDetectorManager so we don't hit the
    // class-field init-before-super-constructor gotcha. The manager already
    // satisfies the minimal `ToolDetector` contract (only `getBestTool` is
    // consumed by the search impls).
    if (this.app?.toolDetectorManager) {
      this.impl.setToolDetector(this.app.toolDetectorManager);
    }
    return this.impl.grep(params);
  }

  async checkToolAvailable(tool: string): Promise<boolean> {
    return this.impl.checkToolAvailable(tool);
  }
}
