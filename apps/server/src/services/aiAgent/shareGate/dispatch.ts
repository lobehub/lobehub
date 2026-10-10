import { isShareToolApiGranted } from '@lobechat/const';
import type { AgentShareToolGrant } from '@lobechat/types';

import { isGovernedByBuiltinAllowlist, SHARE_VISITOR_ALLOWED_IDENTIFIERS } from './allowlist';
import { DATA_TOOL_ACCESS_RULES } from './dataToolRules';
import { resolveEffectiveShareToolGrants } from './grants';
import { SUB_AGENT_DISPATCH_APIS } from './subAgentDispatch';
import type { ShareDataToolPermissions } from './types';

/**
 * Whether a specific `identifier`/`apiName` tool call must be blocked for a
 * share visitor run. This is the enforcement counterpart of
 * `applyShareGateToDataToolAccess` below, reusable from the actual dispatch
 * chokepoint (`BuiltinToolsExecutor.execute`, which invokes
 * `runtime[apiName](...)` directly and never re-consults the possibly
 * already-trimmed manifest — the trimmed manifest only changes what the model
 * is OFFERED via function-calling schema, not what the executor is willing to
 * run if the model calls it anyway).
 *
 * DEFAULT-DENY for the builtin population: an `identifier` that resolves
 * against the real `@lobechat/builtin-tools` registry
 * (`isGovernedByBuiltinAllowlist`) but is NOT in
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS` is blocked outright, with no
 * `apiName`-level distinction. A non-builtin identifier (MCP server, market
 * plugin, custom plugin) is NOT this function's concern at all — it falls
 * through to `false` untouched, left entirely to
 * {@link filterPluginsByShareGate} / `shareConfig.toolGrants`.
 *
 * `args` is the tool call's parsed arguments, needed only for
 * `isArgsOutOfScope` rules. Omit it for call sites that only need the
 * identifier/apiName-level check (grant / write / always-blocked).
 */
export const isShareBlockedDataToolCall = (
  permissions: ShareDataToolPermissions,
  identifier: string,
  apiName: string,
  args?: any,
): boolean => {
  // Outside this gate's jurisdiction entirely — MCP/market/custom plugin
  // identifiers are governed by the toolGrants picker, not this allowlist.
  if (!isGovernedByBuiltinAllowlist(identifier)) return false;

  // Default-deny: a known builtin identifier not on the allowlist is blocked
  // unconditionally, including any tool registered after this allowlist was
  // written — the whole point of inverting a denylist.
  if (!SHARE_VISITOR_ALLOWED_IDENTIFIERS.has(identifier)) return true;

  const rule = DATA_TOOL_ACCESS_RULES[identifier];
  if (!rule) return false;

  const grant = rule.grant(permissions);
  if (grant === 'none') return true;

  if (rule.writeApiNames.includes(apiName)) return true;
  if (rule.alwaysBlockedApiNames?.includes(apiName)) return true;
  if (args !== undefined && rule.isArgsOutOfScope?.(permissions, apiName, args)) return true;

  return false;
};

/**
 * FULL dispatch-time gate for a share-visitor builtin tool call — the check
 * `BuiltinToolsExecutor.execute` runs on every call that reaches it. Strictly
 * wider than {@link isShareBlockedDataToolCall}: a call that bypassed
 * assembly (resume path, recovery hint, model-fabricated call to a tool it
 * was never offered) must clear ALL the same gates the assembled tool set
 * enforced, not only the data-tool rules:
 *
 * 1. master default-deny allowlist (`SHARE_VISITOR_ALLOWED_IDENTIFIERS`);
 * 2. the owner's own `toolGrants` picker — being on the master allowlist
 *    is necessary but NOT sufficient; a tool the creator never enabled for
 *    this share (e.g. image generation spending the creator's quota) must not
 *    run just because a call reached the executor;
 * 3. the per-API data-tool rules ({@link isShareBlockedDataToolCall}).
 *
 * Non-builtin identifiers (MCP/market/custom plugins, LobeHub skills) pass
 * through untouched: their id namespace does not reliably match
 * `toolGrants` identifiers, so they remain governed by the assembly-time
 * `filterPluginsByShareGate` intersection only.
 */
export const isShareBlockedBuiltinDispatch = (
  agentShare: ShareDataToolPermissions & { toolGrants?: AgentShareToolGrant[] },
  identifier: string,
  apiName: string,
  args?: any,
): boolean => {
  if (!isGovernedByBuiltinAllowlist(identifier)) return false;

  if (!SHARE_VISITOR_ALLOWED_IDENTIFIERS.has(identifier)) return true;
  // The owner's picker must grant this identifier at all (toolset-level or
  // naming this specific `apiName`) — a grant scoped to a DIFFERENT api on
  // the same identifier does not authorize this call.
  if (!isShareToolApiGranted(resolveEffectiveShareToolGrants(agentShare), identifier, apiName))
    return true;

  // Sub-agent dispatch has no humanIntervention config to catch it, and the
  // server sub-agent runner spawns the child via a plain `execAgent` call
  // that does NOT thread the parent's shareGate — the child would run with
  // the creator's full, unrestricted tool surface. Assembly strips the API
  // (`stripSubAgentDispatchApis`); this is its dispatch-time counterpart.
  if (SUB_AGENT_DISPATCH_APIS[identifier]?.apiName === apiName) return true;

  // `humanIntervention` is deliberately NOT re-checked here: share runs keep
  // the manifest's intervention config and honor the visitor's own approval
  // mode, so an intervention-gated call reaches this executor only after the
  // visitor approved it (or chose auto-run). Granting a tool grants its normal
  // approval flow.
  return isShareBlockedDataToolCall(agentShare, identifier, apiName, args);
};
