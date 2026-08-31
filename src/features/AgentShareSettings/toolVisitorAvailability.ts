import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  isAgentShareAllowedBuiltinIdentifier,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';

/**
 * How a tool the owner configured on the agent relates to a share visitor's run:
 *
 * - `available` — the owner can grant it and the server gate will honor it.
 * - `blocked` — the server refuses it for visitor runs no matter what is
 *   stored, so the owner must not be offered the toggle at all.
 * - `needsMemoryPermission` — grantable, but inert until the separate
 *   "allow reading my memory" permission is on.
 */
export type ShareToolAvailability = 'available' | 'blocked' | 'needsMemoryPermission';

/**
 * Mirrors the two server-side gates a visitor tool call passes, in the same
 * order `isShareBlockedDataToolCall` applies them
 * (`apps/server/src/services/aiAgent/shareGate.ts`):
 *
 * 1. `isAgentShareAllowedBuiltinIdentifier` — the master default-deny
 *    allowlist. Non-builtin identifiers (MCP servers, market plugins, custom
 *    plugins) fall outside its jurisdiction entirely and are governed only by
 *    the owner's `enabledToolIds` picker.
 * 2. `AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS` — tools that survive the
 *    allowlist only to be blocked outright by `DATA_TOOL_ACCESS_RULES`, whose
 *    grant is unconditionally `none` (knowledge base, agent documents: no such
 *    grant exists in `AgentShareConfig` at all).
 *
 * Both sets are exported from `@lobechat/builtin-tools` precisely so this
 * picker reads the same source the gate enforces instead of hand-copying
 * identifiers that could drift.
 */
export const getShareToolAvailability = (
  toolId: string,
  permissions: { allowReadMemory?: boolean } = {},
): ShareToolAvailability => {
  if (!isAgentShareAllowedBuiltinIdentifier(toolId)) return 'blocked';
  if (AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS.has(toolId)) return 'blocked';
  if (toolId === MemoryIdentifier && !permissions.allowReadMemory) return 'needsMemoryPermission';

  return 'available';
};

/** Whether the owner may grant `toolId` to visitors at all (see {@link getShareToolAvailability}). */
export const isToolAvailableToVisitors = (toolId: string): boolean =>
  getShareToolAvailability(toolId) !== 'blocked';

/**
 * `shareConfig.enabledToolIds` filtered down to the ids that should render as
 * an active visitor grant. A share edited while a since-denied builtin was
 * still allowed may keep a now-blocked identifier persisted; rendering it as
 * selected would confirm a grant no visitor run can use.
 *
 * PRESENTATION ONLY. Never build a save payload from this — see
 * {@link toggleShareToolId}, which composes over the FULL persisted array so
 * ids this picker does not render survive the write.
 */
export const getVisitorVisibleEnabledToolIds = (enabledToolIds: string[] | undefined): string[] =>
  (enabledToolIds ?? []).filter((toolId) => isToolAvailableToVisitors(toolId));

/**
 * Add or remove `toolId` from the PERSISTED whitelist.
 *
 * Deliberately composes over the stored array rather than the displayed one:
 * the picker only renders tools this agent currently has configured and that
 * the gate can honor, so replacing the array with the rendered selection would
 * silently drop ids belonging to a plugin the owner temporarily disabled, or
 * to a tool a newer build knows about and this one does not.
 */
export const toggleShareToolId = (
  enabledToolIds: string[] | undefined,
  toolId: string,
): string[] => {
  const stored = enabledToolIds ?? [];

  return stored.includes(toolId) ? stored.filter((id) => id !== toolId) : [...stored, toolId];
};

/**
 * Runtime-managed builtin tool identifiers (Knowledge Base, Memory, Web
 * Browsing, ...) that the server's agent mode rules can enable on a run
 * independently of `agentConfig.plugins`. `getActivePluginIds` only reflects
 * the owner's plugin selection, so a picker built from that list alone could
 * never surface these ids — and `applyShareGateToToolSet` strips any tool id
 * absent from `enabledToolIds`, so e.g. the "allow reading memory" switch
 * would silently have no effect.
 *
 * Filtered through {@link isToolAvailableToVisitors} so tools the gate always
 * refuses (device, local system, sandbox, knowledge base, agent documents)
 * stay out of the picker instead of adding rows the owner cannot act on.
 */
export const runtimeManagedShareCandidateToolIds: string[] = runtimeManagedToolIds.filter(
  (toolId) => isToolAvailableToVisitors(toolId),
);

/**
 * Full candidate set for the share tool picker: the owner's configured
 * plugins plus the runtime-managed builtin tools a share can ever grant.
 * Deduplicated because a runtime-managed tool id may already be pinned in
 * `pluginIds` (e.g. image generation).
 *
 * An always-blocked tool the owner explicitly configured on the agent is still
 * listed — rendered disabled with an explanation, so the owner learns why it
 * cannot be shared instead of wondering where it went. Blocked tools are only
 * omitted when they would have been added by
 * {@link runtimeManagedShareCandidateToolIds}, i.e. when the owner never
 * picked them in the first place.
 */
export const getShareToolCandidateIds = (pluginIds: string[]): string[] =>
  Array.from(new Set([...pluginIds, ...runtimeManagedShareCandidateToolIds]));
