import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';

export interface ScannedAgent<P> {
  provider: P;
  version?: string;
}

/**
 * Split a device scan into what is installed (with its version) and what was
 * probed but not found, in the providers' display order. Types the device did
 * not probe at all (older clients) are left out rather than shown as missing.
 */
export const partitionScan = <P extends { type: string }>(
  scan: HeterogeneousAgentScanMap,
  providers: P[],
): { installed: ScannedAgent<P>[]; missing: P[] } => {
  const installed: ScannedAgent<P>[] = [];
  const missing: P[] = [];
  for (const provider of providers) {
    const status = scan[provider.type as keyof HeterogeneousAgentScanMap];
    if (!status) continue;
    if (status.available) installed.push({ provider, version: status.version });
    else missing.push(provider);
  }
  return { installed, missing };
};
