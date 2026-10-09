import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  hasShareToolGrant,
  resolveShareAllowedSkillIds,
  resolveShareToolGrants,
  type ShareToolGrant,
} from '@lobechat/const';

import type { AgentShareGate, ShareDataToolPermissions } from './types';

/**
 * Intersect a run's candidate plugin/skill ids with the share whitelist.
 * The whitelist defaults to empty, so an unconfigured share exposes no tools.
 *
 * Identifier-level only: an entry granting just one API
 * (`{ identifier: 'lobe-agent', apis: ['analyzeMedia'] }`) still counts as
 * "this identifier is a
 * candidate" here — narrowing the offer down to that specific API happens
 * later, in {@link applyShareGateToToolSet}, once the real manifest is known.
 */
export const filterPluginsByShareGate = (pluginIds: string[], gate: AgentShareGate): string[] => {
  const grants = resolveShareToolGrants(gate.shareConfig.toolGrants);

  return pluginIds.filter((id) => hasShareToolGrant(grants, id));
};

/**
 * Intersect a run's candidate SKILL ids with the share's skill grants.
 *
 * Skills are governed by `shareConfig.skillGrants`, not `toolGrants`: a skill
 * grant also authorizes the no-tool path (a pinned skill's body is injected
 * straight into context), so it cannot be expressed as a grant on the
 * `lobe-skills` tool entry. See {@link resolveShareAllowedSkillIds} for the
 * default-closed semantics.
 *
 * Kept next to {@link filterPluginsByShareGate} so the two read as the pair
 * they are; callers must not use the plugin filter for skill ids.
 */
export const filterSkillsByShareGate = (skillIds: string[], gate: AgentShareGate): string[] =>
  resolveShareAllowedSkillIds(skillIds, gate.shareConfig);

/**
 * Builtins whose Share grant is also their runtime opt-in.
 *
 * Agent Documents is a default activatable builtin rather than a profile
 * plugin, so creators have no separate profile switch that could place it in
 * `agentConfig.plugins`. Adding it here only after an explicit Share grant
 * lets the picker act as that opt-in for visitor runs while keeping the
 * default-closed behavior. The final tool-set gate still narrows its APIs.
 */
export const getShareGrantActivatedPluginIds = (gate: AgentShareGate): string[] => {
  const grants = resolveShareToolGrants(gate.shareConfig.toolGrants);

  return hasShareToolGrant(grants, AgentDocumentsIdentifier) ? [AgentDocumentsIdentifier] : [];
};

/**
 * Whether the share grants `lobe-cloud-sandbox` (at any API scope). Drives
 * `resolveExecutionPlan`'s `sandboxFallback`: a visitor can never reach the
 * creator's device, so this grant is only meaningful if the plan resolves to
 * the sandbox instead of collapsing to `none`.
 */
export const shareGateGrantsCloudSandbox = (gate: AgentShareGate): boolean =>
  hasShareToolGrant(
    resolveShareToolGrants(gate.shareConfig.toolGrants),
    CloudSandboxManifest.identifier,
  );

/**
 * Strip agent files / knowledge bases from a share visitor's resolved agent
 * config. Mutates in place — `agentConfig` is threaded through the whole
 * orchestration by reference (tool discovery, knowledge flags, context builder
 * snapshot), so a filtered copy would silently diverge.
 *
 * ADAPTATION vs the original design: the share config no longer carries a
 * `filePermissionConfig` field, so there is no grant a creator could set that
 * would expose their agent files or knowledge bases to a visitor. The gate is
 * therefore unconditional rather than conditional — the fail-closed reading of
 * "no configured permission". Re-introducing a file grant means restoring the
 * config field AND relaxing this function together.
 */
export const applyShareGateToAgentConfig = (agentConfig: {
  files?: unknown[] | null;
  knowledgeBases?: unknown[] | null;
}): void => {
  agentConfig.files = [];
  agentConfig.knowledgeBases = [];
};

/**
 * Whether this share authorizes any skill at all — the condition under which
 * the `lobe-skills` tool itself becomes available to a visitor.
 *
 * Skills are NOT picked in the tool picker, so no creator ever writes a
 * `lobe-skills` entry into `toolGrants`; the skill list IS the opt-in, the same
 * way {@link getShareGrantActivatedPluginIds} lets the Documents grant double as
 * that tool's runtime opt-in. Without this, a share could list skills the
 * visitor's model has no tool to load.
 */
export const hasShareSkillAuthorization = (permissions: ShareDataToolPermissions): boolean =>
  (permissions.skillGrants?.length ?? 0) > 0;

/**
 * `resolveShareToolGrants` plus the grants that are implied rather than picked.
 *
 * Today that is only `lobe-skills`, whose opt-in lives in `skillGrants` (see
 * {@link hasShareSkillAuthorization}). The synthetic grant is toolset-level
 * (`'all'`) on purpose: narrowing the Skills tool down to its two visitor-safe
 * APIs is {@link DATA_TOOL_ACCESS_RULES}' job, and expressing it twice would
 * let the two lists drift.
 *
 * Every gate that asks "did the creator grant this identifier" must go through
 * here, or the tool passes one layer and is rejected by the next.
 */
export const resolveEffectiveShareToolGrants = (
  permissions: ShareDataToolPermissions,
): Map<string, ShareToolGrant> => {
  const grants = resolveShareToolGrants(permissions.toolGrants);

  if (hasShareSkillAuthorization(permissions)) grants.set(SkillsIdentifier, 'all');

  return grants;
};
