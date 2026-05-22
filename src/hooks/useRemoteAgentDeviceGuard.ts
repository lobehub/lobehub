import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { useCallback, useEffect, useState } from 'react';

import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';

export type RemoteAgentDeviceStatus =
  | 'checking'
  | 'device-offline'
  | 'no-device'
  | 'ok'
  | 'platform-unavailable';

interface UseRemoteAgentDeviceGuardOptions {
  enabled?: boolean;
}

interface UseRemoteAgentDeviceGuardResult {
  refresh: () => void;
  status: RemoteAgentDeviceStatus;
}

/**
 * Checks whether the bound device is online and the agent platform is available.
 * Used in HeterogeneousChatInput to gate sending for openclaw / hermes agents.
 */
export const useRemoteAgentDeviceGuard = ({
  enabled = true,
}: UseRemoteAgentDeviceGuardOptions = {}): UseRemoteAgentDeviceGuardResult => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const agencyConfig = useAgentStore((s) =>
    agentId ? s.agentMap[agentId]?.agencyConfig : undefined,
  );

  const boundDeviceId = agencyConfig?.boundDeviceId;
  const providerType = agencyConfig?.heterogeneousProvider?.type;

  const [status, setStatus] = useState<RemoteAgentDeviceStatus>('checking');

  const check = useCallback(async () => {
    if (!enabled) return;

    if (!boundDeviceId) {
      setStatus('no-device');
      return;
    }

    setStatus('checking');

    try {
      const devices = await lambdaClient.device.listDevices.query();
      const device = devices.find((d) => d.deviceId === boundDeviceId);

      if (!device || !device.online) {
        setStatus('device-offline');
        return;
      }

      if (providerType && isRemoteHeterogeneousType(providerType)) {
        const capability = await lambdaClient.device.checkCapability.query({
          deviceId: boundDeviceId,
          platform: providerType,
        });
        setStatus(capability.available ? 'ok' : 'platform-unavailable');
      } else {
        setStatus('ok');
      }
    } catch {
      // On error, allow sending — don't block user on network issues
      setStatus('ok');
    }
  }, [enabled, boundDeviceId, providerType]);

  useEffect(() => {
    void check();
  }, [check]);

  // Re-check when window regains focus
  useEffect(() => {
    if (!enabled) return;
    const handler = () => void check();
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [enabled, check]);

  return { refresh: () => void check(), status };
};
