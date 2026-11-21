import type {
  HeterogeneousAgentScanMap,
  HeterogeneousAgentScanStatus,
  HeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { DeviceListItem } from '@lobechat/types';
import { useCallback, useMemo, useRef, useState } from 'react';

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
  /** While scanning: the rows settled so far. */
  agents: HeterogeneousAgentScanMap | null;
  error?: string;
  /**
   * The agent types whose probe has settled, in arrival order — while scanning,
   * and after a scan this hook ran (absent when another surface on the shared
   * key did the scan). A settled type may be missing from `agents` when the
   * host does not know it.
   */
  settled?: HeterogeneousAgentType[];
  status: 'error' | 'idle' | 'scanning' | 'success';
}

/** Reports probes as they settle; an `undefined` status = the host does not know that type. */
type ProgressReporter = (
  entries: [HeterogeneousAgentType, HeterogeneousAgentScanStatus | undefined][],
) => void;

interface ScanResult {
  agents: HeterogeneousAgentScanMap | null;
  error?: string;
}

const IDLE: AgentScanState = { agents: null, status: 'idle' };

const SCAN_TYPES = CONNECTABLE_PROVIDERS.map((provider) => provider.type);

const toMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Local scans probe every connectable agent through the desktop binary detector.
 * Although OpenClaw and Hermes use the gateway execution path, they are installed
 * on and selected from this machine just like the coding-agent CLIs. Each probe
 * is its own IPC call, so `onProgress` hears about every agent as it settles.
 */
export const scanLocal = async (
  onProgress?: ProgressReporter,
): Promise<HeterogeneousAgentScanMap> => {
  const entries = await Promise.all(
    CONNECTABLE_PROVIDERS.map(async (provider) => {
      let status: HeterogeneousAgentScanStatus;
      try {
        const detected = await binaryService.detectHeterogeneousAgentCommand({
          agentType: provider.type,
          command: provider.command ?? provider.type,
        });
        status = {
          available: detected.available,
          ...(detected.error ? { reason: detected.error } : undefined),
          version: detected.version,
        };
      } catch (error) {
        status = { available: false, reason: toMessage(error) };
      }
      onProgress?.([[provider.type, status]]);
      return [provider.type, status] as const;
    }),
  );
  return Object.fromEntries(entries);
};

/**
 * Device scans ask the device for one agent type per call so each row lands
 * on its own. The first probe goes alone and doubles as a capability check:
 * a device client that predates the type filter answers it with the full map,
 * which is then the whole result — one scan, exactly what it cost before —
 * instead of every fanned-out call triggering another full scan on it.
 */
export const scanDevice = async (
  deviceId: string,
  onProgress?: ProgressReporter,
): Promise<ScanResult> => {
  const [first, ...rest] = SCAN_TYPES;

  const head = await deviceService.scanAgents({ agentTypes: [first], deviceId });
  // The device did not answer (offline, busy, tool missing): nothing else will.
  if (head.error) return { agents: null, error: head.error };

  if (Object.keys(head.agents).some((type) => type !== first)) {
    onProgress?.(SCAN_TYPES.map((type) => [type, head.agents[type]]));
    return { agents: head.agents };
  }

  const agents: HeterogeneousAgentScanMap = { ...head.agents };
  onProgress?.([[first, head.agents[first]]]);

  await Promise.all(
    rest.map(async (type) => {
      let status: HeterogeneousAgentScanStatus | undefined;
      try {
        const result = await deviceService.scanAgents({ agentTypes: [type], deviceId });
        status = result.error ? { available: false, reason: result.error } : result.agents[type];
      } catch (error) {
        status = { available: false, reason: toMessage(error) };
      }
      if (status) agents[type] = status;
      onProgress?.([[type, status]]);
    }),
  );

  return { agents };
};

const scanTargetKey = (target: ScanTarget | null) => {
  if (!target) return null;
  // Same key as the device page's agent runtimes, so either surface reuses the other's probe.
  return target.kind === 'local'
    ? ['connectAgent/localScan']
    : ['device/agentScan', target.device.deviceId];
};

interface ScanProgress {
  agents: HeterogeneousAgentScanMap;
  keyId: string;
  settled: HeterogeneousAgentType[];
}

/**
 * The agent inventory of the picked target. Keyed by target, so picking one
 * (or opening the wizard on one) scans it; `rescan` re-probes in place. While
 * a scan runs, `state.agents` and `state.settled` fill in agent by agent.
 */
export const useAgentScan = (target: ScanTarget | null) => {
  const key = scanTargetKey(target);
  const keyId = key?.join('/') ?? null;

  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const runRef = useRef(0);

  const { data, error, isValidating, mutate } = useClientDataSWR(
    key,
    async (): Promise<ScanResult> => {
      const run = ++runRef.current;
      const runKeyId = keyId!;
      setProgress({ agents: {}, keyId: runKeyId, settled: [] });

      const report: ProgressReporter = (entries) => {
        if (run !== runRef.current) return;
        setProgress((prev) => {
          if (prev?.keyId !== runKeyId) return prev;
          const agents = { ...prev.agents };
          for (const [type, status] of entries) if (status) agents[type] = status;
          return {
            agents,
            keyId: runKeyId,
            settled: [...prev.settled, ...entries.map(([type]) => type)],
          };
        });
      };

      return target?.kind === 'device'
        ? scanDevice(target.device.deviceId, report)
        : { agents: await scanLocal(report) };
    },
    // Only an explicit rescan re-probes: it also clears the picked runtimes, which
    // a silent refresh (focus, reconnect, retry) would leave pointing at stale rows.
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );

  const state = useMemo<AgentScanState>(() => {
    if (!target) return IDLE;
    if (isValidating || (!data && !error)) {
      // A scan another surface started on the shared key reports no progress:
      // its rows stay pending until the whole map lands.
      const live = progress?.keyId === keyId ? progress : null;
      return { agents: live?.agents ?? {}, settled: live?.settled ?? [], status: 'scanning' };
    }
    const failure = error ? toMessage(error) : data?.error;
    if (failure) return { agents: null, error: failure, status: 'error' };
    const settled = progress?.keyId === keyId ? progress.settled : undefined;
    return { agents: data!.agents, ...(settled && { settled }), status: 'success' };
  }, [data, error, isValidating, keyId, progress, target]);

  const rescan = useCallback(() => void mutate(), [mutate]);

  return { rescan, state };
};
