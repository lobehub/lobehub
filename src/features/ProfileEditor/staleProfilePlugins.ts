import { type AgentPluginEntry, parsePluginEntry } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useEffect, useRef } from 'react';

import { useSingleton } from '@/hooks/useSingleton';
import { ensureAgentMarketSkills } from '@/services/ensureAgentMarketSkills';
import type { EnsureMarketSkillResult } from '@/services/skill';
import type { ToolStoreState } from '@/store/tool/initialState';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { UNINSTALLED_BUILTIN_TOOLS_KEY } from '@/store/tool/slices/builtin/projection';
import { CONNECTOR_LIST_KEY } from '@/store/tool/slices/connector/projection';
import { INSTALLED_PLUGINS_KEY } from '@/store/tool/slices/plugin/projection';

/**
 * Whether every asynchronously loaded catalog that feeds `validIdentifiers`
 * holds the server's answer. An unloaded catalog is empty, and a catalog
 * hydrated from IndexedDB can predate a tool installed on another device, so
 * pruning against either would delete valid tools and persist the loss. This
 * includes custom connectors: `isConnectorsInit` already turns true on the
 * IndexedDB hydrate, before the server list arrives.
 *
 * @see https://github.com/lobehub/lobehub/issues/18856
 */
export const selectProfileToolCatalogsSynced = (s: ToolStoreState): boolean =>
  s.installedPluginsReplica.entries[INSTALLED_PLUGINS_KEY]?.source === 'server' &&
  s.connectorsReplica.entries[CONNECTOR_LIST_KEY]?.source === 'server' &&
  s.uninstalledBuiltinToolsReplica.entries[UNINSTALLED_BUILTIN_TOOLS_KEY]?.source === 'server' &&
  agentSkillsSelectors.isAgentSkillListSynced(s);

export interface StalePluginCleanupInput {
  /**
   * Workspace role permits editing own content (`edit_own_content`). Personal
   * mode is always `true`.
   */
  canEditContent: boolean;
  /**
   * Workspace General access on this agent resolves to "may edit". Defaults
   * permissive outside a workspace.
   */
  canEditResource: boolean;
  /**
   * The workspace access query has settled. Cleanup waits for it rather than
   * running on the permissive loading default.
   */
  isAccessResolved: boolean;
  /**
   * Connector identifiers are absent from `validIdentifiers` until
   * `fetchConnectors()` resolves, so pruning before that would mark enabled
   * connectors as stale.
   */
  isConnectorsInit: boolean;
  /**
   * Installed plugins, custom connectors, installed builtin tools and agent
   * skills have all been loaded from the server
   * (`selectProfileToolCatalogsSynced`), and the server config that decides the
   * connector catalog has loaded successfully. Until then a
   * valid custom tool is missing from `validIdentifiers`.
   */
  isToolCatalogSynced: boolean;
  plugins: AgentPluginEntry[] | undefined;
  validIdentifiers: ReadonlySet<string>;
}

/**
 * Whether the automatic cleanup may touch this agent's plugins at all. The
 * permission inputs matter as much as the staleness ones (automatic corrections
 * must not trigger phantom save-error toasts): this cleanup is automatic, so in
 * a workspace a caller without resource edit access would fire an
 * `agent.updateAgentConfig` the server rejects — and because the rejected write
 * never persists, it would fire and fail again on *every* open, surfacing
 * "Failed to save agent settings" on an agent the user only viewed. Fail closed
 * while access is still resolving.
 */
const isCleanupAllowed = ({
  canEditContent,
  canEditResource,
  isAccessResolved,
  isConnectorsInit,
  isToolCatalogSynced,
  plugins,
  validIdentifiers,
}: StalePluginCleanupInput): boolean => {
  if (!canEditContent || !isAccessResolved || !canEditResource) return false;
  if (!isConnectorsInit || !isToolCatalogSynced) return false;
  if (validIdentifiers.size === 0) return false;
  return (plugins ?? []).length > 0;
};

/**
 * Identifiers of the plugin entries that do not resolve to any known tool, or
 * `[]` when the gates in `isCleanupAllowed` are not all satisfied. Entries are
 * checked by identifier regardless of shape or mode, so a disabled or pinned
 * object entry counts like a legacy string one.
 *
 * These are what the server is asked about before anything is removed: an
 * unresolved identifier may be a Market skill the agent references that is not
 * installed yet.
 */
export const resolveUnresolvedPluginIds = (input: StalePluginCleanupInput): string[] => {
  if (!isCleanupAllowed(input)) return [];

  const unresolved = new Set<string>();
  for (const entry of input.plugins ?? []) {
    const { identifier } = parsePluginEntry(entry);
    if (!input.validIdentifiers.has(identifier)) unresolved.add(identifier);
  }
  return [...unresolved];
};

/**
 * Decide whether the agent profile should drop plugin entries, and to what.
 *
 * An unresolved entry is removed only when the server positively said it is not
 * a Market skill (`notSkill`). Installed, skipped, failed and unreported
 * entries stay: a failed download must not delete a valid skill binding.
 * Surviving entries keep their original shape, mode and order (lazy per-item
 * upgrade; a disabled entry is never re-enabled).
 *
 * Returns the cleaned list when a write is warranted, or `null` to leave the
 * config alone. The same gates are re-checked here, so a caller that evaluates
 * this after an `await` also fails closed on a permission lost meanwhile.
 */
export const resolveStalePluginCleanup = (
  input: StalePluginCleanupInput,
  ensureResults: readonly EnsureMarketSkillResult[] = [],
): AgentPluginEntry[] | null => {
  if (!isCleanupAllowed(input)) return null;

  const notSkill = new Set(
    ensureResults.filter((result) => result.status === 'notSkill').map((r) => r.identifier),
  );
  if (notSkill.size === 0) return null;

  const rawPlugins = input.plugins ?? [];
  const isRemoved = (entry: AgentPluginEntry) => {
    const { identifier } = parsePluginEntry(entry);
    return notSkill.has(identifier) && !input.validIdentifiers.has(identifier);
  };

  if (!rawPlugins.some(isRemoved)) return null;

  return rawPlugins.filter((entry) => !isRemoved(entry));
};

export interface StalePluginAutoResolveInput extends StalePluginCleanupInput {
  agentId: string;
  /** The agent's plugins as stored right now, read when a response comes back. */
  getCurrentPlugins: () => AgentPluginEntry[] | undefined;
  /**
   * The active cache scope (user + workspace) as rendered, and as it is right
   * now; attempts and results never cross it.
   */
  getScope: () => string;
  scope: string;
  updatePlugins: (agentId: string, plugins: AgentPluginEntry[]) => unknown;
}

/** Coalesces the burst of catalog updates that arrive together. */
const AUTO_RESOLVE_DEBOUNCE_MS = 500;

/**
 * Self-heal an agent's plugins once the tool catalogs are complete: ask the
 * server about unresolved identifiers (they may be uninstalled Market skills),
 * then drop only those it says are not skills.
 *
 * One attempt per scope + agent, also while it is in flight. A response is
 * applied only if the scope, agent, permissions and the plugins it was started
 * from are all unchanged; otherwise the write is abandoned and the attempt is
 * released so the new state gets its own.
 */
export const useStalePluginAutoResolve = (input: StalePluginAutoResolveInput): void => {
  const latest = useRef(input);
  latest.current = input;
  const attempted = useSingleton(() => new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async () => {
    const snapshot = latest.current;
    const { agentId, scope } = snapshot;
    const key = `${scope}\u0000${agentId}`;
    if (!agentId || attempted.has(key)) return;

    const unresolved = resolveUnresolvedPluginIds(snapshot);
    if (unresolved.length === 0) return;

    attempted.add(key);
    let results: EnsureMarketSkillResult[] = [];
    try {
      results = await ensureAgentMarketSkills(unresolved);
    } catch {
      // The helper does not throw; keep every entry if it somehow does.
    }

    const current = latest.current;
    const unchanged =
      mounted.current &&
      current.agentId === agentId &&
      current.scope === scope &&
      snapshot.getScope() === scope &&
      isEqual(snapshot.getCurrentPlugins(), snapshot.plugins);
    if (!unchanged) {
      attempted.delete(key);
      return;
    }

    const cleaned = resolveStalePluginCleanup({ ...current, plugins: snapshot.plugins }, results);
    if (!cleaned) return;
    try {
      await current.updatePlugins(agentId, cleaned);
    } catch {
      // Best-effort self-healing; a rejected write is retried on the next open.
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void run(), AUTO_RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `run` only reads refs; the inputs below are what should re-evaluate it.
  }, [
    input.agentId,
    input.scope,
    input.plugins,
    input.validIdentifiers,
    input.canEditContent,
    input.canEditResource,
    input.isAccessResolved,
    input.isConnectorsInit,
    input.isToolCatalogSynced,
  ]);
};
