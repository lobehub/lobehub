import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { useCallback, useEffect, useState } from 'react';

import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { deviceService } from '@/services/device';

export type RemoteAgentDeviceStatus =
  'checking' | 'cli-unavailable' | 'device-offline' | 'no-device' | 'ok' | 'platform-unavailable';

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
 * Checks whether the bound device is online and, for notify-based hetero
 * platforms, whether that platform is available on the device. Used in
 * HeterogeneousChatInput before device-dispatched hetero runs.
 */
export const useRemoteAgentDeviceGuard = ({
  agentId,
  enabled = true,
}: UseRemoteAgentDeviceGuardOptions): UseRemoteAgentDeviceGuardResult => {
  // Effective config = shared row + this member's per-agent device override
  //. Checking the raw shared `boundDeviceId` would probe whichever
  // machine landed on the shared row (usually the creator's, often offline)
  // instead of the device THIS member picked — a false "device offline".
  const { agencyConfig, isPreferenceLoading } = useEffectiveAgencyConfig(agentId);

  const boundDeviceId = agencyConfig?.boundDeviceId;
  const provider = agencyConfig?.heterogeneousProvider;
  const providerType = provider?.type;
  const requiresCli = providerType === 'codex' && provider?.authMode === 'api';

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

      // A shared/legacy binding may point at the author's personal principal,
      // which is intentionally absent from the caller-scoped device list. The
      // server owns that routing decision; absence here is not proof of offline.
      if (!device) {
        setStatus(requiresCli ? 'cli-unavailable' : 'ok');
        return;
      }

      if (!device.online) {
        setStatus('device-offline');
        return;
      }

      if (requiresCli && !device.channels?.some((connection) => connection.channel === 'cli')) {
        setStatus('cli-unavailable');
        return;
      }

      if (providerType && isRemoteHeterogeneousType(providerType)) {
        const capability = await deviceService.checkCapability({
          deviceId: boundDeviceId,
          platform: providerType,
          scope: device.scope,
        });
        setStatus(capability.available ? 'ok' : 'platform-unavailable');
      } else {
        setStatus('ok');
      }
    } catch {
      // API bindings require positive CLI presence; native routing keeps its
      // existing fail-open behavior and server-side device authorization.
      setStatus(requiresCli ? 'cli-unavailable' : 'ok');
    }
  }, [enabled, isPreferenceLoading, boundDeviceId, providerType, requiresCli]);

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
