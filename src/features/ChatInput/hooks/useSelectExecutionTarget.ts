'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { useCallback } from 'react';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { getSourceDeviceId } from '@/utils/sourceDevice';

/**
 * Persist an execution-target selection for an agent.
 *
 * Storage:
 * - **Personal agent** — writes to
 *   `users.preference.personalDeviceOverrides[agentId][sourceDeviceId]`
 *   so each machine's choice is independent. `agents.agencyConfig` is left
 *   untouched (old data remains as fallback; new agents stay null → platform default).
 * - **Workspace agent** — writes to
 *   `workspace_user_settings.preference.agentDeviceOverrides[agentId][sourceDeviceId]`
 *   (per-user per-workspace per-device).
 */
export const useSelectExecutionTarget = (agentId: string) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const isWorkspaceAgent = useAgentStore((s) => Boolean(s.agentMap[agentId]?.workspaceId));

  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  const updatePreference = useUserStore((s) => s.updatePreference);
  const workspaceUserPreference = useUserStore((s) => s.workspaceUserPreference);
  const userPreference = useUserStore((s) => s.preference);

  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  return useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string) => {
      const boundDeviceId = agencyConfig?.boundDeviceId;
      let nextBoundDeviceId = target === 'device' ? deviceId : boundDeviceId;
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

      const override = {
        executionTarget: target,
        ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
      };
      const sourceDeviceId = isDesktop ? currentDeviceId : getSourceDeviceId();
      const sourceKey = sourceDeviceId || '*';

      // A legacy flat override (`{ executionTarget, boundDeviceId }`) reads as a
      // whole-object override in `resolveOverrideBySource`, so it would shadow
      // the new per-source entry. Normalize it to a `'*'` source key first.
      const normalizeBySource = (
        raw: Record<string, any> | undefined,
      ): Record<string, any> | undefined =>
        raw && ('executionTarget' in raw || 'boundDeviceId' in raw) ? { '*': raw } : raw;

      if (isWorkspaceAgent) {
        const bySource = normalizeBySource(
          workspaceUserPreference.agentDeviceOverrides?.[agentId] as
            Record<string, any> | undefined,
        );
        const nextOverrides = {
          ...workspaceUserPreference.agentDeviceOverrides,
          [agentId]: { ...bySource, [sourceKey]: override },
        };
        await updateWorkspaceUserPreference({ agentDeviceOverrides: nextOverrides });
        return;
      }

      // Personal agent
      const bySource = normalizeBySource(
        userPreference.personalDeviceOverrides?.[agentId] as Record<string, any> | undefined,
      );
      const nextOverrides = {
        ...userPreference.personalDeviceOverrides,
        [agentId]: { ...bySource, [sourceKey]: override },
      };
      await updatePreference({ personalDeviceOverrides: nextOverrides });
    },
    [
      agentId,
      agencyConfig,
      currentDeviceId,
      isHetero,
      isWorkspaceAgent,
      updateWorkspaceUserPreference,
      updatePreference,
      workspaceUserPreference,
      userPreference,
    ],
  );
};
