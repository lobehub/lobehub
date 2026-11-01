'use client';

import { isCollaborativeBuiltinAgentRow } from '@lobechat/builtin-agents';
import type { AgentModelSelectionPolicy } from '@lobechat/types';
import { resolveAgentModelConfig, resolveAgentModelSelectionPolicy } from '@lobechat/types';
import { useCallback } from 'react';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

import { useChatInputResourceAccess } from './useChatInputResourceAccess';

interface ModelSelection {
  model: string;
  provider: string;
}

interface SelectModelOptions {
  /**
   * Throw when the write fails instead of only reporting it, so a caller can
   * confirm success (e.g. a "model switched" toast). The member-override path
   * always throws on failure.
   */
  rethrow?: boolean;
  /** Keep the agent store's generic save-failure toast. @default true */
  showErrorMessage?: boolean;
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
  /**
   * Resolves `false` when the caller may not switch right now (locked, or
   * access/preference still loading), so nothing was written.
   */
  selectModel: (selection: ModelSelection, options?: SelectModelOptions) => Promise<boolean>;
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
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));
  const sharedAgencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const sharedModel = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const sharedProvider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));
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
    async (selection: ModelSelection, options?: SelectModelOptions) => {
      if (!canSelectModel) return false;

      if (usesWorkspaceMemberSelection) {
        if (selectionPolicy !== 'member' || isLoading) return false;

        await updateWorkspaceUserPreference({
          agentModelOverrides: {
            ...preference.agentModelOverrides,
            [agentId]: selection,
          },
        });
        return true;
      }

      await updateAgentConfigById(agentId, applyBusinessModelModeConfig(selection), options);
      return true;
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
