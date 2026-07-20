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
  isWorkspaceAgent: boolean;
  selectionPolicy: AgentModelSelectionPolicy;
  selectModel: (selection: ModelSelection) => Promise<void>;
}

/**
 * Read and update the model used by the current caller for one Agent.
 *
 * Personal Agents keep the legacy behavior: selecting a model updates the
 * Agent row. Workspace Agents in member-selection mode instead write a
 * per-user override, leaving the shared default untouched. The same hook is
 * used by both chat model triggers so their displayed value and write target
 * cannot diverge.
 */
export const useAgentModelSelection = (agentId: string): UseAgentModelSelectionResult => {
  const sharedAgencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const sharedModel = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const sharedProvider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  const storePreference = useUserStore((s) => s.workspaceUserPreference);
  const { data: fetchedPreference, isLoading } = useUserStore(
    (s) => s.useFetchWorkspaceUserPreference,
  )();
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});
  const memberOverride = isWorkspaceAgent ? preference.agentModelOverrides?.[agentId] : undefined;
  const effectiveModel = resolveAgentModelConfig(
    {
      agencyConfig: sharedAgencyConfig,
      model: sharedModel,
      provider: sharedProvider,
    },
    memberOverride,
  );
  const selectionPolicy = sharedAgencyConfig?.modelSelectionPolicy ?? 'fixed';
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const selectModel = useCallback(
    async (selection: ModelSelection) => {
      if (isWorkspaceAgent) {
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
      isWorkspaceAgent,
      preference.agentModelOverrides,
      selectionPolicy,
      updateAgentConfigById,
      updateWorkspaceUserPreference,
    ],
  );

  return {
    isPreferenceLoading: isWorkspaceAgent && isLoading,
    isWorkspaceAgent,
    model: effectiveModel.model,
    provider: effectiveModel.provider ?? sharedProvider,
    selectionPolicy,
    selectModel,
  };
};
