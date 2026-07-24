import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { resolveAgentAgencyConfig } from '@lobechat/types';

import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

export interface UseEffectiveAgencyConfigResult {
  /** Shared `agents.agencyConfig` merged with the caller's per-agent override. */
  agencyConfig: LobeAgentAgencyConfig | undefined;
  /** Whether the execution target is ready to be shown as an effective runtime summary. */
  canDisplayExecutionTarget: boolean;
  /** Whether this caller may open the execution-target selector. */
  canSelectExecutionTarget: boolean;
  /**
   * The workspace preference fetch is still in flight. Until it settles, a
   * workspace agent's `agencyConfig` may reflect only the shared row — callers
   * that act on `boundDeviceId` / `executionTarget` (device guards, defaults)
   * should wait instead of acting on a value that may flip.
   */
  isPreferenceLoading: boolean;
  /**
   * The effective config still comes from the workspace-shared fallback because
   * this member has not explicitly selected an execution target. Callers must
   * preserve workspace coercion so a legacy shared `local` value cannot execute
   * on whichever member happens to open the agent.
   */
  workspaceScoped: boolean;
}

/**
 * The agent's EFFECTIVE `agencyConfig` for the current caller.
 *
 * The workspace-shared `agents.agencyConfig` is one row per agent, but each
 * member picks their own execution device after the Agent is public
 * (LOBE-11689) — that pick lives in
 * `workspace_user_settings.preference.agentDeviceOverrides[agentId]` and must
 * be merged over the shared row via `resolveAgentAgencyConfig` at read time.
 * Reading the shared row alone shows whichever device landed there (usually
 * the creator's machine) instead of this member's choice.
 *
 * Personal and Private Workspace Agents have a single owner whose choice IS
 * the shared config, so the override and member policy are applied only for
 * public Workspace Agents — mirroring the write side (`useSelectExecutionTarget`).
 *
 * Self-populates the workspace preference cache (SWR dedupes across callers;
 * personal mode short-circuits without a network call).
 */
export const useEffectiveAgencyConfig = (agentId?: string): UseEffectiveAgencyConfigResult => {
  const sharedAgencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  );
  const agent = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentById(agentId)(s) : undefined,
  );
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberSelection =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;

  // Prefer the SWR response over the store bucket: the SWR cache is keyed by
  // the ACTIVE workspace, while the zustand bucket is a single un-keyed slot —
  // when switching back to a workspace whose preference is already cached,
  // `isLoading` is false immediately but the bucket still holds the previous
  // workspace's data until revalidation lands. Optimistic writes stay visible
  // because `updateWorkspaceUserPreference` mutates the SWR cache too. The
  // bucket remains the fallback for the pre-first-response window; a `null`
  // response (no server row yet) means "no override", not "use the bucket".
  const { data: fetchedPreference, isLoading } = useUserStore(
    (s) => s.useFetchWorkspaceUserPreference,
  )();
  const storePreference = useUserStore((s) => s.workspaceUserPreference);
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});
  const override = agentId ? preference.agentDeviceOverrides?.[agentId] : undefined;
  const agencyConfig = resolveAgentAgencyConfig(sharedAgencyConfig, override, {
    canManage: canManageAgent,
    visibility: agent?.visibility,
    workspaceId: agent?.workspaceId,
  });
  const isPreferenceLoading = isAccessLoading || (usesWorkspaceMemberSelection && isLoading);

  return {
    agencyConfig,
    canDisplayExecutionTarget: !!agentId && !isPreferenceLoading,
    canSelectExecutionTarget:
      !!agentId && !isPreferenceLoading && agencyConfig?.executionTargetSelectionPolicy !== 'fixed',
    isPreferenceLoading,
    workspaceScoped: resolveWorkspaceScoped(usesWorkspaceMemberSelection, override),
  };
};
