import type { HeterogeneousAgentType } from '../config';

/**
 * Availability of one heterogeneous agent on a scanned host.
 */
export interface HeterogeneousAgentScanStatus {
  available: boolean;
  reason?: string;
  /**
   * The host can update this CLI in place over the device RPCs. Absent from
   * clients that predate remote agent CLI updates, so they never offer it.
   */
  updatable?: boolean;
  version?: string;
}

/** A remote update of one agent CLI on a device, as the device reports it. */
export interface HeterogeneousAgentCliUpdateJob {
  agentType: string;
  /** Last lines of the updater's output, when it failed. */
  error?: string;
  finishedAt?: number;
  /** Version detected before the update started. */
  fromVersion?: string;
  startedAt: number;
  status: 'failed' | 'running' | 'succeeded';
  /** Version detected after a successful update. */
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
