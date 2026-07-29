import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { useCallback, useEffect, useState } from 'react';

import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { deviceService } from '@/services/device';

export type RemoteAgentDeviceStatus =
  'checking' | 'device-offline' | 'no-device' | 'ok' | 'platform-unavailable';

interface UseRemoteAgentDeviceGuardOptions {
  /** The conversation's agent — validate this agent's bound device, not the global active one. */
  agentId: string;
  enabled?: boolean;
}

interface UseRemoteAgentDeviceGuardResult {
  refresh: () => void;
  status: RemoteAgentDeviceStatus;
}

/**
 * Checks whether the bound device is online and, for remote-only hetero
 * platforms, whether that platform is available on the device. Used in
 * HeterogeneousChatInput before device-dispatched hetero runs.
 */
export const useRemoteAgentDeviceGuard = ({
  agentId,
  enabled = true,
}: UseRemoteAgentDeviceGuardOptions): UseRemoteAgentDeviceGuardResult => {
  // Effective config = shared row + this member's per-agent device override
  // (LOBE-11689). Checking the raw shared `boundDeviceId` would probe whichever
  // machine landed on the shared row (usually the creator's, often offline)
  // instead of the device THIS member picked — a false "device offline".
  const { agencyConfig, isPreferenceLoading } = useEffectiveAgencyConfig(agentId);

  const boundDeviceId = agencyConfig?.boundDeviceId;
  const providerType = agencyConfig?.heterogeneousProvider?.type;

  const [status, setStatus] = useState<RemoteAgentDeviceStatus>('checking');

  const check = useCallback(async () => {
    if (!enabled) return;

    // The override hasn't loaded yet — `boundDeviceId` may still be the shared
    // row's device. Stay in `checking` (non-blocking) rather than flash an
    // offline banner for a device this member never picked; the load flips
    // `isPreferenceLoading` and re-runs the check.
    if (isPreferenceLoading) {
      setStatus('checking');
      return;
    }

    if (!boundDeviceId) {
      setStatus('no-device');
      return;
    }

    setStatus('checking');

    try {
      const devices = await deviceService.listDevices();
      const device = devices.find((d) => d.deviceId === boundDeviceId);

      if (!device || !device.online) {
        setStatus('device-offline');
        return;
      }

      if (providerType && isRemoteHeterogeneousType(providerType)) {
        const capability = await deviceService.checkCapability({
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
  }, [enabled, isPreferenceLoading, boundDeviceId, providerType]);

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
