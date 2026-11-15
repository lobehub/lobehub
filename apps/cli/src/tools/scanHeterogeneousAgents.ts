import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import { scanHeterogeneousAgentsOnHost } from '@lobechat/heterogeneous-agents/scanHost';

export interface ScanHeterogeneousAgentsArgs {
  /** Probe only these agent types; omitted scans every known type. */
  agentTypes?: string[];
}

export interface ScanHeterogeneousAgentsResult {
  agents: HeterogeneousAgentScanMap;
}

/**
 * Probe heterogeneous agent types on this device: every known type, or only
 * `agentTypes` when the connect wizard fans out one probe per agent.
 * Dispatched by the server via the `device.scanAgents` tRPC procedure.
 */
export async function scanHeterogeneousAgents(
  args: ScanHeterogeneousAgentsArgs = {},
): Promise<ScanHeterogeneousAgentsResult> {
  return { agents: await scanHeterogeneousAgentsOnHost({ agentTypes: args.agentTypes }) };
}
