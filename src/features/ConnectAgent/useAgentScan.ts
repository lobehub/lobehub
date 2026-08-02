import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import type { DeviceListItem } from '@lobechat/types';
import { useCallback, useRef, useState } from 'react';

import { deviceService } from '@/services/device';
import { binaryService } from '@/services/electron/binary';

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
 * Local scans probe the four CLI agents through the desktop binary detector
 * (which + login-shell PATH + well-known install paths). Platform agents
 * (openclaw / hermes) are device-bound by design, so a local target never
 * reports them — the inventory simply omits those rows.
 */
const scanLocal = async (): Promise<HeterogeneousAgentScanMap> => {
  const entries = await Promise.all(
    HETEROGENEOUS_AGENT_CLIENT_CONFIGS.map(async (config) => {
      try {
        const status = await binaryService.detectHeterogeneousAgentCommand({
          agentType: config.type,
          command: config.command,
        });
        return [config.type, { available: status.available, version: status.version }] as const;
      } catch {
        return [config.type, { available: false }] as const;
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
