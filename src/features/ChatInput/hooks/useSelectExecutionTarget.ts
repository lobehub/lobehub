'use client';

import { isDesktop } from '@lobechat/const';
import { type DeviceExecutionTarget, snapshotTopicExecutionConfig } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback } from 'react';

import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { useSingleton } from '@/hooks/useSingleton';
import { useTopicAgencyConfig } from '@/hooks/useTopicAgencyConfig';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

export interface SelectExecutionTargetOptions {
  localSandbox?: boolean;
  localSandboxNetwork?: boolean;
  silent?: boolean;
}

/**
 * Persist an execution-target selection at the scope represented by the chat
 * input: an existing Topic owns an isolated snapshot, while the empty Agent
 * entry edits the Agent default that future Topics inherit.
 */
export const useSelectExecutionTarget = (agentId: string) => {
  const workspaceDefaultSaveQueueRef = useSingleton(() => ({ current: Promise.resolve() }));
  const { agencyConfig: topicAgencyConfig, canSelectExecutionTarget } =
    useTopicAgencyConfig(agentId);
  const topicId = useChatStore((s) => (s.activeAgentId === agentId ? s.activeTopicId : undefined));

  // Agent-default writes deliberately use the shared row rather than the
  // effective Topic/member overlay. Workspace routing below decides whether a
  // pick belongs in that row or in this member's per-Agent preference.
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const isWorkspaceAgent = useAgentStore((s) => Boolean(s.agentMap[agentId]?.workspaceId));
  const isPublicWorkspaceAgent = useAgentStore((s) => {
    const agent = s.agentMap[agentId];
    return !!agent?.workspaceId && agent.visibility !== 'private';
  });
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const { canManageAgent } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberSelection = isPublicWorkspaceAgent && !canManageAgent;

  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  const workspaceUserPreference = useUserStore((s) => s.workspaceUserPreference);

  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  return useCallback(
    async (
      target: DeviceExecutionTarget,
      deviceId?: string,
      options?: SelectExecutionTargetOptions,
    ) => {
      if (!canSelectExecutionTarget) return;

      const localSandboxPatch = {
        ...(options?.localSandbox === undefined ? {} : { localSandbox: options.localSandbox }),
        ...(options?.localSandboxNetwork === undefined
          ? {}
          : { localSandboxNetwork: options.localSandboxNetwork }),
      };

      if (topicId) {
        try {
          let boundDeviceId = target === 'device' ? deviceId : undefined;
          if (target === 'local') {
            boundDeviceId =
              currentDeviceId ?? (await gatewayConnectionService.getDeviceInfo())?.deviceId;
            if (!boundDeviceId) return;
          }
          if (target === 'device' && !boundDeviceId) return;

          await useChatStore.getState().updateTopicMetadata(topicId, {
            executionConfig: {
              ...snapshotTopicExecutionConfig(topicAgencyConfig),
              inheritWorkspaceScope: false,
              boundDeviceId,
              executionTarget: target,
              ...localSandboxPatch,
            },
          });
        } catch {
          if (!options?.silent) toast.error(t('saveTopicExecutionConfigFail', { ns: 'common' }));
        }
        return;
      }

      const previousBoundDeviceId = agencyConfig?.boundDeviceId;
      let nextBoundDeviceId = target === 'device' ? deviceId : previousBoundDeviceId;
      if (target === 'local') {
        nextBoundDeviceId = currentDeviceId;
        if (!nextBoundDeviceId) {
          try {
            nextBoundDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
          } catch {
            nextBoundDeviceId = undefined;
          }
        }
        if (isHetero && !nextBoundDeviceId) return;
      }

      // The callback may have yielded while discovering the local device. Do
      // not turn an Agent-default pick into a save after the user entered a
      // Topic (or switched to another Agent).
      const chat = useChatStore.getState();
      if (chat.activeAgentId !== agentId || chat.activeTopicId) return;

      const previousOverride = workspaceUserPreference.agentDeviceOverrides?.[agentId];
      const updatesOnlyWorkspaceSandboxSettings =
        isWorkspaceAgent &&
        target !== 'local' &&
        (options?.localSandbox !== undefined || options?.localSandboxNetwork !== undefined);

      // A member selection is personal to that Workspace member. `local` is
      // also always personal, including for managers/private-Agent owners,
      // because a personal desktop device must never enter the shared row.
      // Sandbox flags are personal too, even when edited while another target
      // is active; in that case preserve the existing routing fields.
      if (
        usesWorkspaceMemberSelection ||
        (isWorkspaceAgent && target === 'local') ||
        updatesOnlyWorkspaceSandboxSettings
      ) {
        const nextOverride = {
          ...previousOverride,
          ...(updatesOnlyWorkspaceSandboxSettings
            ? {}
            : {
                executionTarget: target,
                ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
              }),
          ...localSandboxPatch,
        };

        try {
          await updateWorkspaceUserPreference({
            agentDeviceOverrides: { [agentId]: nextOverride },
          });
        } catch {
          if (!options?.silent) toast.error(t('saveAgentConfigFail', { ns: 'common' }));
        }
        return;
      }

      const saveAgentDefault = async () => {
        const currentChat = useChatStore.getState();
        if (currentChat.activeAgentId !== agentId || currentChat.activeTopicId) return;

        // Clear a manager's personal routing override before changing the
        // shared default. If either write fails, other members keep the old
        // shared value; a failed shared write restores this caller's override.
        let clearedRoutingOverride = false;
        if (
          isWorkspaceAgent &&
          previousOverride &&
          (previousOverride.executionTarget !== undefined ||
            previousOverride.boundDeviceId !== undefined)
        ) {
          const { boundDeviceId: _device, executionTarget: _target, ...dormant } = previousOverride;
          try {
            await updateWorkspaceUserPreference({
              agentDeviceOverrides: { [agentId]: dormant },
            });
            clearedRoutingOverride = true;
          } catch {
            if (!options?.silent) toast.error(t('saveAgentConfigFail', { ns: 'common' }));
            return;
          }
        }

        try {
          await updateAgentConfigById(
            agentId,
            {
              agencyConfig: {
                ...agencyConfig,
                executionTarget: target,
                ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
                ...localSandboxPatch,
              },
            },
            {
              rethrow: true,
              ...(options?.silent ? { showErrorMessage: false } : {}),
            },
          );
        } catch {
          if (clearedRoutingOverride && previousOverride) {
            try {
              await updateWorkspaceUserPreference({
                agentDeviceOverrides: { [agentId]: previousOverride },
              });
            } catch (error) {
              console.error(
                '[useSelectExecutionTarget] Failed to restore workspace override:',
                error,
              );
            }
          }
        }
      };

      if (!isWorkspaceAgent) return saveAgentDefault();

      // Shared saves must not overlap: the Agent store aborts an older update
      // for the same Agent, which would otherwise make its rollback shadow a
      // newer selection with the previous personal override.
      const save = workspaceDefaultSaveQueueRef.current.then(saveAgentDefault, saveAgentDefault);
      workspaceDefaultSaveQueueRef.current = save;
      await save;
    },
    [
      agentId,
      agencyConfig,
      canSelectExecutionTarget,
      currentDeviceId,
      isHetero,
      isWorkspaceAgent,
      topicAgencyConfig,
      topicId,
      updateAgentConfigById,
      updateWorkspaceUserPreference,
      usesWorkspaceMemberSelection,
      workspaceUserPreference,
    ],
  );
};
