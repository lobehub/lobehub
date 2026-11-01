import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { useCallback, useEffect, useState } from 'react';

import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { deviceService } from '@/services/device';
import {
  deviceSelectors,
  isDevicePresenceUnknown,
  useDeviceList,
  useDeviceStore,
} from '@/store/device';

export type RemoteAgentDeviceStatus =
  'checking' | 'device-offline' | 'no-device' | 'ok' | 'platform-unavailable';

interface UseRemoteAgentDeviceGuardOptions {
  /** The conversation's agent — validate this agent's bound device, not the global active one. */
  agentId: string;
  enabled?: boolean;
  /**
   * The conversation's topic, whose device binding applies — a side-by-side
   * pane must not validate the globally active topic's device. `null` means the
   * conversation has no topic; omitted, it follows the active topic.
   */
  topicId?: string | null;
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
  topicId,
}: UseRemoteAgentDeviceGuardOptions): UseRemoteAgentDeviceGuardResult => {
  // Effective config = shared row + this member's per-agent device override
  //. Checking the raw shared `boundDeviceId` would probe whichever
  // machine landed on the shared row (usually the creator's, often offline)
  // instead of the device THIS member picked — a false "device offline".
  const { agencyConfig, isPreferenceLoading } = useEffectiveAgencyConfig(agentId, { topicId });

  const boundDeviceId = agencyConfig?.boundDeviceId;
  const providerType = agencyConfig?.heterogeneousProvider?.type;

  // The device list is the shared replica every device surface reads — one
  // request per scope, revalidated on focus — not a request of this guard's own.
  const { data: devices, error: deviceListError, mutate: refreshDevices } = useDeviceList();
  const device = boundDeviceId ? devices?.find((d) => d.deviceId === boundDeviceId) : undefined;
  // A persisted copy painted before the server answered: its rows say nothing
  // about presence, and a device missing from it may simply be newer than it.
  const isListConfirmed = useDeviceStore(deviceSelectors.isDeviceListConfirmed);
  // Notify-based platforms must also be available on the device.
  const remoteType =
    providerType && isRemoteHeterogeneousType(providerType) ? providerType : undefined;

  const listStatus = ((): RemoteAgentDeviceStatus | 'capability' => {
    // Disabled, or the override hasn't loaded yet — `boundDeviceId` may still
    // be the shared row's device. Stay in `checking` (non-blocking) rather than
    // flash an offline banner for a device this member never picked.
    if (!enabled || isPreferenceLoading) return 'checking';
    if (!boundDeviceId) return 'no-device';
    // The last list request failed: whatever presence the store still holds
    // (stored copy or an earlier answer) may be stale. Allow sending rather
    // than block the user on a network issue.
    if (deviceListError) return 'ok';
    if (!isListConfirmed || (device && isDevicePresenceUnknown(device))) return 'checking';
    // A shared/legacy binding may point at the author's personal principal,
    // which is intentionally absent from the caller-scoped device list. The
    // server owns that routing decision; absence here is not proof of offline.
    if (!device) return 'ok';
    if (!device.online) return 'device-offline';
    return remoteType ? 'capability' : 'ok';
  })();

  // Platform availability is a live probe of the device, so it stays a request
  // of its own, re-run when the window regains focus.
  const [capability, setCapability] = useState<{ available: boolean; key: string }>();
  const [probeRound, setProbeRound] = useState(0);
  const probe = listStatus === 'capability' ? device : undefined;
  const probeDeviceId = probe?.deviceId;
  const probeScope = probe?.scope;
  const capabilityKey = probe ? `${probeDeviceId}:${probeScope}:${remoteType}` : '';

  useEffect(() => {
    if (!probeDeviceId || !remoteType) return;
    let cancelled = false;
    const key = `${probeDeviceId}:${probeScope}:${remoteType}`;
    deviceService
      .checkCapability({ deviceId: probeDeviceId, platform: remoteType, scope: probeScope })
      .then(
        (result) => !cancelled && setCapability({ available: result.available, key }),
        // On error, allow sending — don't block the user on network issues.
        () => !cancelled && setCapability({ available: true, key }),
      );
    return () => {
      cancelled = true;
    };
  }, [probeDeviceId, probeScope, remoteType, probeRound]);

  const refresh = useCallback(() => {
    void refreshDevices();
    setProbeRound((round) => round + 1);
  }, [refreshDevices]);

  // Re-check when window regains focus
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [enabled, refresh]);

  const status: RemoteAgentDeviceStatus =
    listStatus !== 'capability'
      ? listStatus
      : capability?.key !== capabilityKey
        ? 'checking'
        : capability.available
          ? 'ok'
          : 'platform-unavailable';

  return { refresh, status };
};
