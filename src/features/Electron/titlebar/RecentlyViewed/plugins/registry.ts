import { type PageReference, type PageType, type ResolvedPageData } from '../types';
import {
  type BaseRecentlyViewedPlugin,
  type PluginContext,
  type RecentlyViewedPlugin,
} from './types';

/**
 * Plugin registry for RecentlyViewed system
 * Manages all page type plugins and provides URL parsing/resolution
 */
class PluginRegistry {
  private plugins: Map<PageType, BaseRecentlyViewedPlugin> = new Map();
  private sortedPlugins: BaseRecentlyViewedPlugin[] = [];

  /**
   * Register multiple plugins at once
   */

  register<T extends PageType>(plugins: [RecentlyViewedPlugin<T>]): void;
  register<T extends PageType, T2 extends PageType>(
    plugins: [RecentlyViewedPlugin<T>, RecentlyViewedPlugin<T2>],
  ): void;
  register<T extends PageType, T2 extends PageType, T3 extends PageType>(
    plugins: [RecentlyViewedPlugin<T>, RecentlyViewedPlugin<T2>, RecentlyViewedPlugin<T3>],
  ): void;
  register<T extends PageType, T2 extends PageType, T3 extends PageType, T4 extends PageType>(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
    T6 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
      RecentlyViewedPlugin<T6>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
    T6 extends PageType,
    T7 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
      RecentlyViewedPlugin<T6>,
      RecentlyViewedPlugin<T7>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
    T6 extends PageType,
    T7 extends PageType,
    T8 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
      RecentlyViewedPlugin<T6>,
      RecentlyViewedPlugin<T7>,
      RecentlyViewedPlugin<T8>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
    T6 extends PageType,
    T7 extends PageType,
    T8 extends PageType,
    T9 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
      RecentlyViewedPlugin<T6>,
      RecentlyViewedPlugin<T7>,
      RecentlyViewedPlugin<T8>,
      RecentlyViewedPlugin<T9>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
    T6 extends PageType,
    T7 extends PageType,
    T8 extends PageType,
    T9 extends PageType,
    T10 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
      RecentlyViewedPlugin<T6>,
      RecentlyViewedPlugin<T7>,
      RecentlyViewedPlugin<T8>,
      RecentlyViewedPlugin<T9>,
      RecentlyViewedPlugin<T10>,
    ],
  ): void;
  register<
    T extends PageType,
    T2 extends PageType,
    T3 extends PageType,
    T4 extends PageType,
    T5 extends PageType,
    T6 extends PageType,
    T7 extends PageType,
    T8 extends PageType,
    T9 extends PageType,
    T10 extends PageType,
    T11 extends PageType,
  >(
    plugins: [
      RecentlyViewedPlugin<T>,
      RecentlyViewedPlugin<T2>,
      RecentlyViewedPlugin<T3>,
      RecentlyViewedPlugin<T4>,
      RecentlyViewedPlugin<T5>,
      RecentlyViewedPlugin<T6>,
      RecentlyViewedPlugin<T7>,
      RecentlyViewedPlugin<T8>,
      RecentlyViewedPlugin<T9>,
      RecentlyViewedPlugin<T10>,
      RecentlyViewedPlugin<T11>,
    ],
  ): void;
  register(plugins: BaseRecentlyViewedPlugin[]): void {
    for (const plugin of plugins) {
      this.plugins.set(plugin.type, plugin);
    }

    this.updateSortedPlugins();
  }

  /**
   * Parse URL into a page reference using registered plugins
   * Returns null if no plugin matches
   */
  parseUrl(pathname: string, search: string): PageReference | null {
    const searchParams = new URLSearchParams(search);

    for (const plugin of this.sortedPlugins) {
      if (plugin.matchUrl(pathname, searchParams)) {
        const reference = plugin.parseUrl(pathname, searchParams);
        if (reference) {
          return reference;
        }
      }
    }

    return null;
  }

  /**
   * Resolve a page reference into display data
   */
  resolve(reference: PageReference, ctx: PluginContext): ResolvedPageData | null {
    const plugin = this.plugins.get(reference.type);
    if (!plugin) return null;

    return plugin.resolve(reference, ctx);
  }

  /**
   * Resolve multiple page references, filtering out non-existent ones
   */
  resolveAll(references: PageReference[], ctx: PluginContext): ResolvedPageData[] {
    const results: ResolvedPageData[] = [];

    for (const reference of references) {
      const resolved = this.resolve(reference, ctx);
      if (resolved && resolved.exists) {
        results.push(resolved);
      }
    }

    return results;
  }

  /**
   * Update sorted plugins list by priority
   */
  private updateSortedPlugins(): void {
    this.sortedPlugins = Array.from(this.plugins.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
  }
}

export const pluginRegistry = new PluginRegistry();
