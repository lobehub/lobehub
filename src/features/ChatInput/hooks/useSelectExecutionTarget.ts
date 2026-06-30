'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { useCallback } from 'react';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

/**
 * Persist an execution-target selection for an agent. Shared by the device
 * switcher and the sandbox notice so the `local` device-id resolution (which
 * has to find this machine's gateway `deviceId`) lives in one place.
 *
 * `executionTarget` is the single source of truth — the server tool gate +
 * client `getRuntimeModeById` derive `runtimeMode` from it.
 */
export const useSelectExecutionTarget = (agentId: string) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  // The current machine's own gateway deviceId (desktop only); used to pin a
  // `local` selection to this device.
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
        // Hetero agents must execute somewhere; without a resolvable local
        // device there is nothing to pin `local` to, so don't switch.
        if (isHetero && !nextBoundDeviceId) return;
      }

      await updateAgentConfigById(agentId, {
        agencyConfig: {
          ...agencyConfig,
          executionTarget: target,
          ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
        },
      });
    },
    [agentId, agencyConfig, currentDeviceId, isHetero, updateAgentConfigById],
  );
};
