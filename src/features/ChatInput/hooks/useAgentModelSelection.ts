'use client';

import type { AgentModelSelectionPolicy } from '@lobechat/types';
import { resolveAgentModelConfig } from '@lobechat/types';
import { useCallback } from 'react';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

interface ModelSelection {
  model: string;
  provider: string;
}

export interface UseAgentModelSelectionResult extends ModelSelection {
  isPreferenceLoading: boolean;
  selectionPolicy: AgentModelSelectionPolicy;
  selectModel: (selection: ModelSelection) => Promise<void>;
  usesWorkspaceMemberSelection: boolean;
}

/**
 * Read and update the model used by the current caller for one Agent.
 *
 * Personal and private Workspace Agents update their own Agent row. Public
 * Workspace Agents in member-selection mode instead write a per-user
 * override, leaving the shared default untouched. The same hook is used by
 * both chat model triggers so their displayed value and write target cannot
 * diverge.
 */
export const useAgentModelSelection = (agentId: string): UseAgentModelSelectionResult => {
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));
  const sharedAgencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const sharedModel = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const sharedProvider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const usesWorkspaceMemberSelection = !!agent?.workspaceId && agent.visibility !== 'private';

  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  const storePreference = useUserStore((s) => s.workspaceUserPreference);
  const { data: fetchedPreference, isLoading } = useUserStore(
    (s) => s.useFetchWorkspaceUserPreference,
  )();
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});
  const memberOverride = usesWorkspaceMemberSelection
    ? preference.agentModelOverrides?.[agentId]
    : undefined;
  const effectiveModel = resolveAgentModelConfig(
    {
      agencyConfig: sharedAgencyConfig,
      model: sharedModel,
      provider: sharedProvider,
      visibility: agent?.visibility,
    },
    memberOverride,
  );
  const selectionPolicy = sharedAgencyConfig?.modelSelectionPolicy ?? 'fixed';
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const selectModel = useCallback(
    async (selection: ModelSelection) => {
      if (usesWorkspaceMemberSelection) {
        if (selectionPolicy !== 'member' || isLoading) return;

        await updateWorkspaceUserPreference({
          agentModelOverrides: {
            ...preference.agentModelOverrides,
            [agentId]: selection,
          },
        });
        return;
      }

      await updateAgentConfigById(agentId, applyBusinessModelModeConfig(selection));
    },
    [
      agentId,
      applyBusinessModelModeConfig,
      isLoading,
      preference.agentModelOverrides,
      selectionPolicy,
      updateAgentConfigById,
      updateWorkspaceUserPreference,
      usesWorkspaceMemberSelection,
    ],
  );

  return {
    isPreferenceLoading: usesWorkspaceMemberSelection && isLoading,
    model: effectiveModel.model,
    provider: effectiveModel.provider ?? sharedProvider,
    selectionPolicy,
    selectModel,
    usesWorkspaceMemberSelection,
  };
};
