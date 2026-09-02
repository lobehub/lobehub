import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  isAgentShareAllowedBuiltinIdentifier,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';
import {
  buildShareToolEntry,
  parseShareToolEntry,
  resolveShareToolGrants,
  type ShareToolGrant,
} from '@lobechat/const';

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
 * `shareConfig.enabledToolIds` reduced down to the toolset identifiers that
 * should render as an active visitor grant — one entry per identifier, whether
 * it came from a toolset-level entry or one-or-more per-API entries (see
 * {@link resolveShareToolGrants}). A share edited while a since-denied builtin
 * was still allowed may keep a now-blocked identifier persisted; rendering it
 * as selected would confirm a grant no visitor run can use.
 *
 * PRESENTATION ONLY. Never build a save payload from this — see
 * {@link toggleShareToolsetGrant} / {@link toggleShareToolApi}, which compose
 * over the FULL persisted array so entries this picker does not render survive
 * the write.
 */
export const getVisitorVisibleEnabledToolIds = (enabledToolIds: string[] | undefined): string[] =>
  Array.from(resolveShareToolGrants(enabledToolIds).keys()).filter((identifier) =>
    isToolAvailableToVisitors(identifier),
  );

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
 * Replace `identifier`'s grant in the PERSISTED whitelist with `grant`:
 * `'all'` writes a bare toolset-level entry, an array of API names writes one
 * per-API entry each, and `'none'` removes every entry for `identifier`
 * (toolset-level and per-API alike). Always composes over the FULL stored
 * array, same reasoning as {@link toggleShareToolId} — entries for OTHER
 * identifiers this picker does not render must survive the write.
 */
export const setShareToolGrant = (
  enabledToolIds: string[] | undefined,
  identifier: string,
  grant: 'all' | 'none' | string[],
): string[] => {
  const withoutIdentifier = (enabledToolIds ?? []).filter(
    (entry) => parseShareToolEntry(entry)?.identifier !== identifier,
  );

  if (grant === 'none') return withoutIdentifier;
  if (grant === 'all') return [...withoutIdentifier, buildShareToolEntry(identifier)];

  return [
    ...withoutIdentifier,
    ...grant.map((apiName) => buildShareToolEntry(identifier, apiName)),
  ];
};

/**
 * Toggle `identifier`'s TOOLSET-level chip: granting `'all'` when it is
 * currently anything less (unset, or a partial per-API grant), and revoking
 * entirely (`'none'`) when it already grants every API. Matches the tri-state
 * the owner-facing row renders: all APIs granted -> toolset-level entry; some
 * -> per-API entries; none -> removed.
 */
export const toggleShareToolsetGrant = (
  enabledToolIds: string[] | undefined,
  identifier: string,
): string[] =>
  resolveShareToolGrants(enabledToolIds).get(identifier) === 'all'
    ? setShareToolGrant(enabledToolIds, identifier, 'none')
    : setShareToolGrant(enabledToolIds, identifier, 'all');

/**
 * Toggle a single `apiName` within `identifier`'s grant, expanding a
 * toolset-level `'all'` grant into its `availableApiNames` first so removing
 * one API narrows to the rest instead of wiping the whole grant.
 * `availableApiNames` must be the identifier's full set of visitor-grantable
 * API names (i.e. excluding ones {@link getShareApiAvailability} reports as
 * `blocked`) — the caller (which already has the manifest) is the only place
 * that set is known.
 *
 * Deliberately does NOT collapse back to a toolset-level `'all'` entry when
 * every currently-available API ends up individually ticked — least
 * privilege: a toolset-level entry also grants any API added to this tool
 * LATER (e.g. a plugin update), which the owner never explicitly reviewed.
 * Only the toolset chip / {@link toggleShareToolsetGrant} writes `'all'`.
 * Still collapses to `'none'` (removing the identifier entirely) when no API
 * remains selected, so the toolset row's tri-state stays consistent with
 * per-API toggling.
 */
export const toggleShareToolApi = (
  enabledToolIds: string[] | undefined,
  identifier: string,
  apiName: string,
  availableApiNames: string[],
): string[] => {
  const grant = resolveShareToolGrants(enabledToolIds).get(identifier);
  const current = new Set(grant === 'all' ? availableApiNames : grant instanceof Set ? grant : []);

  if (current.has(apiName)) current.delete(apiName);
  else current.add(apiName);

  if (current.size === 0) return setShareToolGrant(enabledToolIds, identifier, 'none');

  return setShareToolGrant(enabledToolIds, identifier, Array.from(current));
};

/**
 * How one API of an ALREADY-visitor-available toolset relates to a share
 * visitor's run — the per-API counterpart of {@link getShareToolAvailability}.
 * Only meaningful for an identifier that is not itself `blocked` at the
 * toolset level; callers render every API of a blocked toolset as blocked
 * without consulting this.
 *
 * Mirrors two of the server's dispatch-time checks
 * (`isShareBlockedBuiltinDispatch` in `shareGate.ts`) cheaply enough to run in
 * the picker without duplicating server-only rules:
 *
 * 1. `humanIntervention` — every share run is forced onto headless approval,
 *    so a `'required'`/`'always'` policy API can never honestly complete (see
 *    `isApiUsableForShareVisitor`'s doc in `shareGate.ts`).
 * 2. `callSubAgent` on `lobe-agent` — sub-agent dispatch is unconditionally
 *    stripped for share visitors regardless of any grant.
 *
 * Deliberately NOT covered: `DATA_TOOL_ACCESS_RULES` write-API blocking (e.g.
 * memory's `addContextMemory`). Duplicating that server-only registry here
 * would drift the moment a new write API is added there without a matching
 * update here — a mis-selected write API is still safely stripped/blocked at
 * the server, just not pre-disabled in this picker. See `shareGate.ts`'s
 * `DATA_TOOL_ACCESS_RULES` for the authoritative list.
 */
export const getShareApiAvailability = (
  identifier: string,
  apiName: string,
  humanIntervention?: unknown,
): 'available' | 'blocked' => {
  if (identifier === LobeAgentIdentifier && apiName === LobeAgentApiName.callSubAgent) {
    return 'blocked';
  }
  if (humanIntervention !== undefined && humanIntervention !== 'never') return 'blocked';

  return 'available';
};

/** Re-exported so callers building a toolset's tri-state can type against it without importing `@lobechat/const` directly. */
export type { ShareToolGrant };

/**
 * `identifier`'s resolved grant from the PERSISTED whitelist: `'all'` for a
 * toolset-level entry, a `Set` of API names for one-or-more per-API entries,
 * or `undefined` when the identifier has no grant at all. Drives the
 * toolset row's tri-state checkbox and which per-API checkboxes render
 * checked once expanded.
 */
export const getShareToolGrantForIdentifier = (
  enabledToolIds: string[] | undefined,
  identifier: string,
): ShareToolGrant | undefined => resolveShareToolGrants(enabledToolIds).get(identifier);

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
