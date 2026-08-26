import { isAgentShareAllowedBuiltinIdentifier } from '@lobechat/builtin-tools';

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
 * render as an active visitor grant. A share created before the visitor gate
 * went default-deny (or edited while a since-denied builtin was still
 * allowed) may still have a now-disallowed identifier persisted — e.g.
 * `lobe-task` or `lobe-agent-management`. Rendering those as selected would
 * confirm a grant no visitor run can ever actually use.
 *
 * Intentionally non-destructive: the underlying persisted config is left
 * alone (the server gate ignores the denied id regardless), so if the
 * identifier is ever added to the allowlist, the existing grant becomes
 * active again without requiring the owner to re-save.
 */
export const getVisitorVisibleEnabledToolIds = (enabledToolIds: string[] | undefined): string[] =>
  (enabledToolIds ?? []).filter(isToolAvailableToVisitors);
