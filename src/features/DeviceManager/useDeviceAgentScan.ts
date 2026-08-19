'use client';

import type {
  HeterogeneousAgentScanMap,
  HeterogeneousAgentScanStatus,
  HeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { KeyedMutator, SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';

export const DEVICE_AGENT_SCAN_SWR_KEY = 'device/agentScan';

/** SWR cache key for one device's heterogeneous-agent scan map. */
export const deviceAgentScanKey = (deviceId: string) =>
  [DEVICE_AGENT_SCAN_SWR_KEY, deviceId] as const;

/** Revalidate the agent scan of one device, or of every device when omitted. */
export const refreshDeviceAgentScan = (deviceId?: string) =>
  mutate((key: unknown) => {
    if (!Array.isArray(key) || key[0] !== DEVICE_AGENT_SCAN_SWR_KEY) return false;
    return deviceId ? key[1] === deviceId : true;
  });

const fetchDeviceAgentScan = async (deviceId: string): Promise<HeterogeneousAgentScanMap> => {
  const result = await deviceService.scanAgents({ deviceId });
  // The device is offline or its client predates the scan tool: the server
  // returns an empty map plus an error, which is surfaced as an SWR `error` so
  // callers can tell "could not check" from the map verdicts below.
  if (result.error) throw new Error(result.error);
  return result.agents ?? {};
};

const pickAgent = (agents: HeterogeneousAgentScanMap | undefined, agentType: string | undefined) =>
  agentType && agents ? agents[agentType as HeterogeneousAgentType] : undefined;

export interface DeviceAgentScanResult extends SWRResponse<
  HeterogeneousAgentScanStatus | undefined
> {
  /**
   * Whether the device answered the scan at least once. The device always
   * reports every agent type it knows; an absent type therefore means its
   * client is too old to know the type (→ ask the user to update the device
   * client), while `scanned: false` means the scan itself failed (offline
   * device, client without the scan tool → unknown).
   */
  scanned: boolean;
}

/**
 * Probe a single device for the availability of one heterogeneous agent type.
 *
 * The server dispatches a `scanHeterogeneousAgents` tool call over the gateway
 * and returns the availability of every known agent type in one pass, so the
 * whole map is cached per device (keyed by `deviceId` only — switching the
 * type under inspection never re-probes the same machine) and only the
 * requested type's entry is exposed. `data` is `undefined` while the probe is
 * in flight, when the scan itself failed, or when the device's client predates
 * the agent type (check {@link scanned} to tell those apart); `error` is set
 * when the device is offline or its client predates the scan tool.
 */
export const useDeviceAgentScan = (
  deviceId: string | undefined,
  agentType: string | undefined,
): DeviceAgentScanResult => {
  const {
    data,
    mutate: revalidate,
    ...rest
  } = useClientDataSWR<HeterogeneousAgentScanMap>(
    deviceId ? deviceAgentScanKey(deviceId) : null,
    () => fetchDeviceAgentScan(deviceId as string),
  ) as SWRResponse<HeterogeneousAgentScanMap>;

  return {
    ...rest,
    data: pickAgent(data, agentType),
    mutate: revalidate as unknown as KeyedMutator<HeterogeneousAgentScanStatus | undefined>,
    scanned: data !== undefined,
  };
};

/**
 * Batch variant of {@link useDeviceAgentScan} for surfaces that render device
 * rows as data (select options) instead of components: probes every device in
 * one SWR entry and exposes a `deviceId → status` map for the requested agent
 * type. A device whose probe failed is mapped to `undefined` in `scanMap` and
 * `false` in `scannedMap` rather than rejecting the whole batch.
 */
export const useDeviceAgentScans = (
  deviceIds: string[] | undefined,
  agentType: string | undefined,
  enabled = true,
) => {
  const ids = deviceIds && deviceIds.length > 0 ? ([...deviceIds].sort() as string[]) : undefined;
  const key =
    enabled && agentType && ids ? [DEVICE_AGENT_SCAN_SWR_KEY, 'batch', ids.join('|')] : null;

  const {
    data,
    mutate: revalidate,
    ...rest
  } = useClientDataSWR<Record<string, HeterogeneousAgentScanMap | undefined>>(key, async () => {
    const entries = await Promise.all(
      (ids as string[]).map(async (deviceId) => {
        try {
          return [deviceId, await fetchDeviceAgentScan(deviceId)] as const;
        } catch {
          // Scan failed (offline / client without the tool) — keep the entry
          // with `undefined` so `scannedMap` can tell it apart from a device
          // that answered but lacks the agent type.
          return [deviceId, undefined] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  });

  const scanMap: Record<string, HeterogeneousAgentScanStatus | undefined> = {};
  const scannedMap: Record<string, boolean> = {};
  for (const [deviceId, agents] of Object.entries(data ?? {})) {
    scannedMap[deviceId] = agents !== undefined;
    scanMap[deviceId] = agents ? pickAgent(agents, agentType) : undefined;
  }

  return { ...rest, revalidate, scanMap, scannedMap };
};
