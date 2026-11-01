import type { HeterogeneousAgentType } from '../config';

/**
 * Availability of one heterogeneous agent on a scanned host.
 */
export interface HeterogeneousAgentScanStatus {
  available: boolean;
  reason?: string;
  version?: string;
}

/**
 * Result of scanning a host for every known heterogeneous agent type.
 * Keys absent from the map mean the type was not probed (e.g. older device
 * clients that predate the scan tool).
 */
export type HeterogeneousAgentScanMap = Partial<
  Record<HeterogeneousAgentType, HeterogeneousAgentScanStatus>
>;
