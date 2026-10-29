import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import type { DeviceListItem } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { binaryService } from '@/services/electron/binary';

import { CONNECTABLE_PROVIDERS } from './providers';

/**
 * Where the wizard scans for installed agents: the local desktop machine
 * (agents run as desktop subprocesses) or a gateway-connected device.
 */
export type ScanTarget = { device: DeviceListItem; kind: 'device' } | { kind: 'local' };

export interface AgentScanState {
  agents: HeterogeneousAgentScanMap | null;
  error?: string;
  status: 'error' | 'idle' | 'scanning' | 'success';
}

const IDLE: AgentScanState = { agents: null, status: 'idle' };

/**
 * Local scans probe every connectable agent through the desktop binary detector.
 * Although OpenClaw and Hermes use the gateway execution path, they are installed
 * on and selected from this machine just like the coding-agent CLIs.
 */
export const scanLocal = async (): Promise<HeterogeneousAgentScanMap> => {
  const entries = await Promise.all(
    CONNECTABLE_PROVIDERS.map(async (provider) => {
      try {
        const status = await binaryService.detectHeterogeneousAgentCommand({
          agentType: provider.type,
          command: provider.command ?? provider.type,
        });
        return [
          provider.type,
          {
            available: status.available,
            ...(status.error ? { reason: status.error } : undefined),
            version: status.version,
          },
        ] as const;
      } catch (error) {
        return [
          provider.type,
          { available: false, reason: error instanceof Error ? error.message : String(error) },
        ] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
};

const scanTargetKey = (target: ScanTarget | null) => {
  if (!target) return null;
  // Same key as the device page's agent runtimes, so either surface reuses the other's probe.
  return target.kind === 'local'
    ? ['connectAgent/localScan']
    : ['device/agentScan', target.device.deviceId];
};

/**
 * The agent inventory of the picked target. Keyed by target, so picking one
 * (or opening the wizard on one) scans it; `rescan` re-probes in place.
 */
export const useAgentScan = (target: ScanTarget | null) => {
  const { data, error, isValidating, mutate } = useClientDataSWR(
    scanTargetKey(target),
    async (): Promise<{ agents: HeterogeneousAgentScanMap | null; error?: string }> =>
      target?.kind === 'device'
        ? deviceService.scanAgents({ deviceId: target.device.deviceId })
        : { agents: await scanLocal() },
    // Only an explicit rescan re-probes: it also clears the picked runtimes, which
    // a silent refresh (focus, reconnect, retry) would leave pointing at stale rows.
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );

  const state = useMemo<AgentScanState>(() => {
    if (!target) return IDLE;
    if (isValidating) return { agents: null, status: 'scanning' };
    const failure = error ? (error instanceof Error ? error.message : String(error)) : data?.error;
    if (failure) return { agents: null, error: failure, status: 'error' };
    if (!data) return { agents: null, status: 'scanning' };
    return { agents: data.agents, status: 'success' };
  }, [data, error, isValidating, target]);

  const rescan = useCallback(() => void mutate(), [mutate]);

  return { rescan, state };
};
