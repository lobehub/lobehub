import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { MEMORY_WRITE_API_NAMES, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  isAgentShareAllowedBuiltinIdentifier,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';
import { resolveShareToolGrants, type ShareToolGrant } from '@lobechat/const';
import type { AgentShareToolGrant, ExtendedHumanInterventionConfig } from '@lobechat/types';

/**
 * How a tool the owner configured on the agent relates to a share visitor's run:
 *
 * - `available` — the owner can grant it and the server gate will honor it.
 * - `blocked` — the server refuses it for visitor runs no matter what is
 *   stored, so the owner must not be offered the toggle at all.
 * - `needsMemoryPermission` — the server gate would strip it until the
 *   separate "allow reading my memory" permission is on, so the picker keeps
 *   the row disabled (with that explanation) rather than accepting a grant
 *   that cannot take effect yet.
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
 *    the owner's `toolGrants` picker.
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
 * `shareConfig.toolGrants` reduced down to the toolset identifiers that should
 * render as an active visitor grant — one entry per identifier, whether it
 * grants every API or only some (see {@link resolveShareToolGrants}). A share
 * edited while a since-denied builtin was still allowed may keep a now-blocked
 * identifier persisted; rendering it as selected would confirm a grant no
 * visitor run can use.
 *
 * PRESENTATION ONLY. Never build a save payload from this — see
 * {@link toggleShareToolsetGrant} / {@link toggleShareToolApi}, which compose
 * over the FULL persisted list so grants this picker does not render survive
 * the write.
 */
export const getVisitorVisibleGrantedToolIds = (
  toolGrants: AgentShareToolGrant[] | undefined,
): string[] =>
  Array.from(resolveShareToolGrants(toolGrants).keys()).filter((identifier) =>
    isToolAvailableToVisitors(identifier),
  );

/**
 * Replace `identifier`'s grant in the PERSISTED list with `grant`: `'all'`
 * writes an entry with no `apis`, an array of API names writes an entry
 * scoped to them, and `'none'` drops the identifier's entry entirely. Always
 * composes over the FULL stored list, same reasoning as
 * {@link toggleShareToolsetGrant} — grants for OTHER identifiers this picker
 * does not render must survive the write.
 */
export const setShareToolGrant = (
  toolGrants: AgentShareToolGrant[] | undefined,
  identifier: string,
  grant: 'all' | 'none' | string[],
): AgentShareToolGrant[] => {
  const withoutIdentifier = (toolGrants ?? []).filter((entry) => entry.identifier !== identifier);

  if (grant === 'none') return withoutIdentifier;
  if (grant === 'all') return [...withoutIdentifier, { identifier }];

  return [...withoutIdentifier, { apis: grant, identifier }];
};

/**
 * Toggle `identifier`'s TOOLSET-level chip. The click cycle is the mature
 * checkbox convention (antd `indeterminate`, Gmail's select-all): none -> all,
 * partial -> all, all -> none. A partial per-API grant therefore always widens
 * to the full toolset on the first click rather than clearing, so one click is
 * never silently destructive of an intent the owner has to rebuild per API.
 *
 * The chip renders the matching tri-state: no grant -> empty box, partial ->
 * indeterminate (minus) box, every API -> checked box.
 */
export const toggleShareToolsetGrant = (
  toolGrants: AgentShareToolGrant[] | undefined,
  identifier: string,
): AgentShareToolGrant[] =>
  resolveShareToolGrants(toolGrants).get(identifier) === 'all'
    ? setShareToolGrant(toolGrants, identifier, 'none')
    : setShareToolGrant(toolGrants, identifier, 'all');

/**
 * Toggle a single `apiName` within `identifier`'s grant, expanding a
 * toolset-level `'all'` grant into its `availableApiNames` first so removing
 * one API narrows to the rest instead of wiping the whole grant.
 * `availableApiNames` must be the identifier's full set of visitor-grantable
 * API names (i.e. excluding ones {@link getShareApiAvailability} reports as
 * `blocked`) — the caller (which already has the manifest) is the only place
 * that set is known.
 *
 * Deliberately does NOT collapse back to a toolset-level `'all'` grant when
 * every currently-available API ends up individually ticked — least
 * privilege: a grant without `apis` also covers any API added to this tool
 * LATER (e.g. a plugin update), which the owner never explicitly reviewed.
 * Only the toolset chip / {@link toggleShareToolsetGrant} writes `'all'`.
 * Still collapses to `'none'` (dropping the identifier entirely) when no API
 * remains selected, so the toolset row's tri-state stays consistent with
 * per-API toggling.
 */
export const toggleShareToolApi = (
  toolGrants: AgentShareToolGrant[] | undefined,
  identifier: string,
  apiName: string,
  availableApiNames: string[],
): AgentShareToolGrant[] => {
  const grant = resolveShareToolGrants(toolGrants).get(identifier);
  const current = new Set(grant === 'all' ? availableApiNames : grant instanceof Set ? grant : []);

  if (current.has(apiName)) current.delete(apiName);
  else current.add(apiName);

  if (current.size === 0) return setShareToolGrant(toolGrants, identifier, 'none');

  return setShareToolGrant(toolGrants, identifier, Array.from(current));
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
 * 3. Memory write APIs — `DATA_TOOL_ACCESS_RULES` strips them from every
 *    visitor run regardless of grant (a share grant is read-only at most).
 *    Read from the same `MEMORY_WRITE_API_NAMES` the gate uses, so a new
 *    write API cannot be added on one side without the other following.
 *
 * Returns `writesOwnerData` (rather than plain `blocked`) for that last case
 * so the picker can explain *why* instead of showing a generic refusal.
 */
export type ShareApiAvailability = 'available' | 'blocked' | 'writesOwnerData';

export const getShareApiAvailability = (
  identifier: string,
  apiName: string,
  humanIntervention?: ExtendedHumanInterventionConfig,
): ShareApiAvailability => {
  if (identifier === LobeAgentIdentifier && apiName === LobeAgentApiName.callSubAgent) {
    return 'blocked';
  }
  if (identifier === MemoryIdentifier && MEMORY_WRITE_API_NAMES.has(apiName as never)) {
    return 'writesOwnerData';
  }
  if (humanIntervention !== undefined && humanIntervention !== 'never') return 'blocked';

  return 'available';
};

/** Re-exported so callers building a toolset's tri-state can type against it without importing `@lobechat/const` directly. */
export type { ShareToolGrant };

/**
 * `identifier`'s resolved grant from the PERSISTED list: `'all'` for a grant
 * without `apis`, a `Set` of API names for an `apis`-scoped grant, or
 * `undefined` when the identifier has no grant at all. Drives the toolset
 * row's tri-state checkbox and which per-API checkboxes render checked once
 * expanded.
 */
export const getShareToolGrantForIdentifier = (
  toolGrants: AgentShareToolGrant[] | undefined,
  identifier: string,
): ShareToolGrant | undefined => resolveShareToolGrants(toolGrants).get(identifier);

/**
 * Runtime-managed builtin tool identifiers (Knowledge Base, Memory, Web
 * Browsing, ...) that the server's agent mode rules can enable on a run
 * independently of `agentConfig.plugins`. `getActivePluginIds` only reflects
 * the owner's plugin selection, so a picker built from that list alone could
 * never surface these ids — and `applyShareGateToToolSet` strips any tool id
 * absent from `toolGrants`, so e.g. the "allow reading memory" switch
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
