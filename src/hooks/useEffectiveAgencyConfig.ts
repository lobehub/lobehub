import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { resolveAgencyConfig } from '@lobechat/types';

import { resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

export interface UseEffectiveAgencyConfigResult {
  /** Shared `agents.agencyConfig` merged with the caller's per-agent override. */
  agencyConfig: LobeAgentAgencyConfig | undefined;
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
 * member picks their own execution device (LOBE-11689) — that pick lives in
 * `workspace_user_settings.preference.agentDeviceOverrides[agentId]` and must
 * be merged over the shared row via `resolveAgencyConfig` at read time.
 * Reading the shared row alone shows whichever device landed there (usually
 * the creator's machine) instead of this member's choice.
 *
 * Personal agents have a single owner whose choice IS the shared config, so
 * the override is only applied for workspace agents — mirroring the write
 * side (`useSelectExecutionTarget`).
 *
 * Self-populates the workspace preference cache (SWR dedupes across callers;
 * personal mode short-circuits without a network call).
 */
export const useEffectiveAgencyConfig = (agentId?: string): UseEffectiveAgencyConfigResult => {
  const sharedAgencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  );
  const isWorkspaceAgent = useAgentStore((s) =>
    agentId ? agentByIdSelectors.isWorkspaceAgentById(agentId)(s) : false,
  );

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

  return {
    agencyConfig: resolveAgencyConfig(sharedAgencyConfig, isWorkspaceAgent ? override : undefined),
    isPreferenceLoading: isWorkspaceAgent && isLoading,
    workspaceScoped: resolveWorkspaceScoped(isWorkspaceAgent, override),
  };
};
