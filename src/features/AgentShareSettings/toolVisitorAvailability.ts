import {
  isAgentShareAllowedBuiltinIdentifier,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';

/**
 * Whether a tool the owner has configured on the agent can ever be granted to
 * a share visitor's run. Delegates to `@lobechat/builtin-tools`'s
 * `isAgentShareAllowedBuiltinIdentifier` — the exact predicate the server-side
 * visitor gate (`apps/server/src/services/aiAgent/shareGate.ts`) enforces at
 * both tool-set assembly and dispatch time — so the settings picker never
 * confirms a grant the server can never honor. Non-builtin identifiers (MCP
 * servers, market plugins, custom plugins) are always available here: they
 * are governed only by the owner's `enabledToolIds` picker, not the builtin
 * allowlist.
 */
export const isToolAvailableToVisitors = (toolId: string): boolean =>
  isAgentShareAllowedBuiltinIdentifier(toolId);

/**
 * `shareConfig.enabledToolIds` filtered down to the ids that should actually
 * render as an active visitor grant. A share edited while a since-denied
 * builtin was still allowed may keep a now-disallowed identifier persisted;
 * rendering those as selected would confirm a grant no visitor run can use.
 *
 * Intentionally non-destructive: the persisted config is left alone (the
 * server gate ignores the denied id regardless), so if the identifier is ever
 * added back to the allowlist the existing grant becomes active again without
 * the owner having to re-save.
 */
export const getVisitorVisibleEnabledToolIds = (enabledToolIds: string[] | undefined): string[] =>
  (enabledToolIds ?? []).filter((toolId) => isToolAvailableToVisitors(toolId));

/**
 * Runtime-managed builtin tool identifiers (Knowledge Base, Memory, Web
 * Browsing, ...) that the server's agent mode rules can enable on a run
 * independently of `agentConfig.plugins`. `getActivePluginIds` only reflects
 * the owner's plugin selection, so a picker built from that list alone could
 * never surface these ids — and `applyShareGateToToolSet` strips any tool id
 * absent from `enabledToolIds`, so e.g. the "allow reading memory" switch
 * would silently have no effect.
 *
 * Filtered through `isToolAvailableToVisitors` so device/local-system/browser
 * /sandbox tools (also runtime-managed, but never grantable to a visitor)
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
 */
export const getShareToolCandidateIds = (pluginIds: string[]): string[] =>
  Array.from(new Set([...pluginIds, ...runtimeManagedShareCandidateToolIds]));
