'use client';

import { isCollaborativeBuiltinAgentRow } from '@lobechat/builtin-agents';
import type { AgentModelSelectionPolicy } from '@lobechat/types';
import { resolveAgentModelConfig, resolveAgentModelSelectionPolicy } from '@lobechat/types';
import { useCallback } from 'react';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentData, useAgentValue } from '@/store/agent/projection';
import { useUserStore } from '@/store/user';

import { useChatInputResourceAccess } from './useChatInputResourceAccess';

interface ModelSelection {
  model: string;
  provider: string;
}

/**
 * Why the model trigger is shown but not switchable, so the trigger can say so
 * instead of silently going inert.
 *
 * - `fixedByAgent` — a public Workspace Agent whose author pinned the model
 *   (`modelSelectionPolicy: 'fixed'`); it changes in the Agent Profile only.
 * - `useOnly` — the caller may chat with the resource but not edit its config.
 */
export type AgentModelSelectionLockReason = 'fixedByAgent' | 'useOnly';

export interface UseAgentModelSelectionResult extends ModelSelection {
  canDisplayModel: boolean;
  canSelectModel: boolean;
  isPreferenceLoading: boolean;
  /** Set only while the model is displayed but locked (see the type doc). */
  selectionLockReason?: AgentModelSelectionLockReason;
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
  const { allowed: canCreateContent } = usePermission('create_content');
  const {
    canConfigureResource,
    canUseResource,
    isAccessLoading: isResourceAccessLoading,
  } = useChatInputResourceAccess();
  const agent = useAgentData(agentId);
  const sharedAgencyConfig = useAgentValue(agentId, agentProjectionSelectors.agencyConfig);
  const sharedModel = useAgentValue(agentId, agentProjectionSelectors.model);
  const sharedProvider = useAgentValue(agentId, agentProjectionSelectors.provider);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  // Collaborative builtins (the builders, Lobe AI, the Page Copilot) are one
  // shared row per Workspace with no config page of their own, so managing the
  // row must not mean picking the model for everyone else — see
  // `AgentModelConfig.personalModelSelection`.
  const personalModelSelection = isCollaborativeBuiltinAgentRow(agent ?? {});
  const usesWorkspaceMemberSelection =
    !!agent?.workspaceId &&
    agent.visibility !== 'private' &&
    (personalModelSelection || !canManageAgent);

  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  const storePreference = useUserStore((s) => s.workspaceUserPreference);
  const { data: fetchedPreference, isLoading } = useUserStore(
    (s) => s.useFetchWorkspaceUserPreference,
  )();
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});
  const memberOverride = usesWorkspaceMemberSelection
    ? preference.agentModelOverrides?.[agentId]
    : undefined;
  const sharedModelConfig = {
    agencyConfig: sharedAgencyConfig,
    model: sharedModel,
    personalModelSelection,
    provider: sharedProvider,
    visibility: agent?.visibility,
    workspaceId: agent?.workspaceId,
    canManage: canManageAgent,
  };
  const effectiveModel = resolveAgentModelConfig(sharedModelConfig, memberOverride);
  const selectionPolicy = resolveAgentModelSelectionPolicy(sharedModelConfig);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();
  const isPreferenceLoading = isAccessLoading || (usesWorkspaceMemberSelection && isLoading);
  const canSelectForAgent = usesWorkspaceMemberSelection
    ? canUseResource && selectionPolicy === 'member'
    : canConfigureResource;
  const canSelectModel =
    canCreateContent && canSelectForAgent && !isResourceAccessLoading && !isPreferenceLoading;
  const canDisplayModel =
    !!agentId &&
    canCreateContent &&
    canUseResource &&
    !isResourceAccessLoading &&
    !isPreferenceLoading;
  // Only meaningful once the trigger actually renders: a hidden trigger has no
  // tooltip to explain, and a still-loading one isn't locked, just not settled.
  const selectionLockReason: AgentModelSelectionLockReason | undefined =
    canDisplayModel && !canSelectModel
      ? usesWorkspaceMemberSelection && selectionPolicy === 'fixed'
        ? 'fixedByAgent'
        : 'useOnly'
      : undefined;

  const selectModel = useCallback(
    async (selection: ModelSelection) => {
      if (!canSelectModel) return;

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
      canSelectModel,
      isLoading,
      preference.agentModelOverrides,
      selectionPolicy,
      updateAgentConfigById,
      updateWorkspaceUserPreference,
      usesWorkspaceMemberSelection,
    ],
  );

  return {
    canDisplayModel,
    canSelectModel,
    isPreferenceLoading,
    model: effectiveModel.model,
    provider: effectiveModel.provider ?? sharedProvider,
    selectionLockReason,
    selectionPolicy,
    selectModel,
    usesWorkspaceMemberSelection,
  };
};
