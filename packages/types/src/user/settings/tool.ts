import type { UserInterventionConfig } from '../../tool';

export interface UserToolConfig {
  /**
   * Ordered crawler impl ids, e.g. ['jina', 'naive']: index 0 is tried first.
   *
   * Ids must be a subset of the server-enabled channels (`CRAWLER_IMPLS`);
   * unknown or disabled ids are ignored at runtime. An empty or missing list
   * falls back to the server default order.
   */
  crawlerImpls?: string[];
  humanIntervention?: UserInterventionConfig;
  /**
   * Ordered search provider ids, e.g. ['searxng', 'exa']: index 0 is tried first.
   *
   * Ids must be a subset of the server-enabled channels (`SEARCH_PROVIDERS`);
   * unknown or disabled ids are ignored at runtime. An empty or missing list
   * falls back to the server default order.
   */
  searchProviders?: string[];
  /**
   * List of builtin tool identifiers that have been uninstalled by the user.
   * By default, all builtin tools are enabled. Users can explicitly
   * uninstall tools they don't want to use.
   *
   * This is the personal-context list (no active workspace). Workspace-scoped
   * lists are kept separately in `uninstalledBuiltinToolsByWorkspace` so a
   * workspace never inherits the user's personal customization.
   */
  uninstalledBuiltinTools?: string[];
  /**
   * Per-workspace uninstalled builtin tool lists, keyed by workspace id.
   * A workspace with no entry falls back to the default seed (i.e. a clean
   * default state), not the user's personal `uninstalledBuiltinTools`.
   */
  uninstalledBuiltinToolsByWorkspace?: Record<string, string[]>;
}

/**
 * User-level search / crawl channel preferences, projected from `UserToolConfig`.
 *
 * Both lists are ordered by priority (index 0 tried first) and share the same
 * subset / fallback semantics documented on the underlying fields.
 */
export type UserChannelPreferences = Pick<UserToolConfig, 'crawlerImpls' | 'searchProviders'>;
