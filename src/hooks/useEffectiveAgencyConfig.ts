import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { resolveAgencyConfig } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

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

  const { isLoading } = useUserStore((s) => s.useFetchWorkspaceUserPreference)();
  const override = useUserStore((s) =>
    agentId ? workspaceUserSettingsSelectors.agentDeviceOverrideById(agentId)(s) : undefined,
  );

  return {
    agencyConfig: resolveAgencyConfig(sharedAgencyConfig, isWorkspaceAgent ? override : undefined),
    isPreferenceLoading: isWorkspaceAgent && isLoading,
  };
};
