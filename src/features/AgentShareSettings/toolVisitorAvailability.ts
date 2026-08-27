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
 *
 * KNOWN GAP (LOBE-11930 P2 re-audit): a `stdio` / local-network MCP connector
 * is a non-builtin identifier, so this predicate has no way to see its
 * connection type and always reports it available once the owner enables it.
 * That class of connector actually tunnels to the OWNER's own paired device
 * at execution time (see `resolveMcpTunnelTarget` in
 * `apps/server/src/services/toolExecution/index.ts`, which always resolves
 * `context.userId` — the creator for a share run, never the visitor). The
 * dispatch layer (`executeMCPTool`'s `context.agentShare` check, same file)
 * fails the call closed instead of tunneling, so the owner sees an accurate
 * "not available" toggle only once server enforcement is in place — this
 * client picker does not yet reflect that as a disabled row. Filtering it
 * here would need connector metadata (`customParams.mcp.type` /
 * `mcpConnectionType`) threaded into this predicate's signature, which no
 * caller currently provides.
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

/**
 * Runtime-managed builtin tool identifiers (Knowledge Base, Memory, Web
 * Browsing, the `lobe-agent` sub-agent tool, ...) that the server's agent
 * mode rules can enable on a run independently of `agentConfig.plugins` — see
 * `agentModeRules` in
 * `apps/server/src/modules/Mecha/AgentToolsEngine/index.ts` (e.g.
 * `[KnowledgeBaseManifest.identifier]: hasEnabledKnowledgeBases` and
 * `[MemoryManifest.identifier]: globalMemoryEnabled` fire regardless of
 * whether those ids are in `agentConfig.plugins`). `getActivePluginIds` only
 * reflects the owner's plugin selection, so a share tool picker built from
 * that list alone can never surface these ids: the owner could never add
 * them to `shareConfig.enabledToolIds`, and `applyShareGateToToolSet`
 * (`shareGate.ts`) unconditionally strips any tool id absent from
 * `enabledToolIds` — regardless of `allowReadMemory` or
 * `filePermissionConfig.knowledgeBase` being on.
 *
 * Filtered through `isToolAvailableToVisitors` so the picker only ever
 * surfaces runtime-managed tools a share visitor's run could actually reach;
 * device/local-system/browser/sandbox tools (also runtime-managed, but never
 * on `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`) stay hidden instead of
 * cluttering the picker with a row the owner can never act on.
 */
export const runtimeManagedShareCandidateToolIds: string[] =
  runtimeManagedToolIds.filter(isToolAvailableToVisitors);

/**
 * Full candidate set for the share tool picker: the owner's configured
 * plugins plus the runtime-managed builtin tools a share can ever grant.
 * Deduplicated because a runtime-managed tool id may also already be present
 * in `pluginIds` (e.g. explicitly pinned, like image generation).
 */
export const getShareToolCandidateIds = (pluginIds: string[]): string[] =>
  Array.from(new Set([...pluginIds, ...runtimeManagedShareCandidateToolIds]));
