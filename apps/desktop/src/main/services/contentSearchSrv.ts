import type {
  BaseContentSearch,
  GrepContentParams,
  GrepContentResult,
} from '@lobechat/local-file-shell/content-search';

import { ServiceModule } from './index';

/**
 * Content Search Service
 * Provides content search functionality using platform-specific implementations
 * sunk into the shared `@lobechat/local-file-shell` package.
 */
export default class ContentSearchService extends ServiceModule {
  private implPromise?: Promise<BaseContentSearch>;

  private getImpl(): Promise<BaseContentSearch> {
    this.implPromise ??= import('@lobechat/local-file-shell/content-search').then(
      ({ createContentSearchImpl }) => createContentSearchImpl(),
    );
    return this.implPromise;
  }

  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    // Lazily wire the desktop BinaryManager so we don't hit the
    // class-field init-before-super-constructor gotcha. The manager already
    // satisfies the minimal `ToolDetector` contract (only `getBestTool` is
    // consumed by the search impls).
    const impl = await this.getImpl();
    if (this.app?.binaryManager) impl.setToolDetector(this.app.binaryManager);
    return impl.grep(params);
  }

  async checkToolAvailable(tool: string): Promise<boolean> {
    return (await this.getImpl()).checkToolAvailable(tool);
  }
}
