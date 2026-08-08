import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import type { DeviceListItem } from '@lobechat/types';
import { useCallback, useRef, useState } from 'react';

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
        return [provider.type, { available: status.available, version: status.version }] as const;
      } catch {
        return [provider.type, { available: false }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
};

export const useAgentScan = () => {
  const [state, setState] = useState<AgentScanState>(IDLE);
  const seqRef = useRef(0);

  const scan = useCallback(async (target: ScanTarget) => {
    const seq = ++seqRef.current;
    setState({ agents: null, status: 'scanning' });

    try {
      let agents: HeterogeneousAgentScanMap;
      if (target.kind === 'local') {
        agents = await scanLocal();
      } else {
        const result = await deviceService.scanAgents({ deviceId: target.device.deviceId });
        if (result.error) {
          if (seq === seqRef.current)
            setState({ agents: null, error: result.error, status: 'error' });
          return;
        }
        agents = result.agents;
      }
      if (seq === seqRef.current) setState({ agents, status: 'success' });
    } catch (error) {
      if (seq === seqRef.current)
        setState({
          agents: null,
          error: error instanceof Error ? error.message : String(error),
          status: 'error',
        });
    }
  }, []);

  const reset = useCallback(() => {
    seqRef.current += 1;
    setState(IDLE);
  }, []);

  return { reset, scan, state };
};
