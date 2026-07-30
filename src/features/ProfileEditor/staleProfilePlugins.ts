import { type AgentPluginEntry, parsePluginEntry } from '@lobechat/types';

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
  plugins: AgentPluginEntry[] | undefined;
  validIdentifiers: ReadonlySet<string>;
}

/**
 * Decide whether the agent profile should silently drop plugin entries whose
 * identifier no longer resolves to any known tool, and to what.
 *
 * Returns the cleaned list when a write is warranted, or `null` to leave the
 * config alone.
 *
 * The permission inputs matter as much as the staleness ones (automatic corrections must not trigger phantom save-error toasts): this
 * cleanup is automatic, so in a workspace a caller without resource edit access
 * would fire an `agent.updateAgentConfig` the server rejects — and because the
 * rejected write never persists, it would fire and fail again on *every* open,
 * surfacing "Failed to save agent settings" on an agent the user only viewed.
 * Fail closed while access is still resolving.
 */
export const resolveStalePluginCleanup = ({
  canEditContent,
  canEditResource,
  isAccessResolved,
  isConnectorsInit,
  plugins,
  validIdentifiers,
}: StalePluginCleanupInput): AgentPluginEntry[] | null => {
  if (!canEditContent || !isAccessResolved || !canEditResource) return null;
  if (!isConnectorsInit) return null;
  if (validIdentifiers.size === 0) return null;

  const rawPlugins = plugins ?? [];
  if (rawPlugins.length === 0) return null;

  // Checked (and filtered) by identifier regardless of entry shape, so a stale
  // disabled/pinned object entry is pruned exactly like a stale legacy string
  // one — untouched valid entries keep their original shape (lazy per-item
  // upgrade).
  const isValid = (entry: AgentPluginEntry) =>
    validIdentifiers.has(parsePluginEntry(entry).identifier);

  if (rawPlugins.every(isValid)) return null;

  return rawPlugins.filter(isValid);
};
