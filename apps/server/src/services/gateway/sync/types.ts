import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';

import type { ConnectionMode } from '../../bot/platforms';

export interface DesiredGatewayConnection {
  connectionMode: ConnectionMode;
  platform: string;
  provider: DecryptedBotProvider;
}

export interface ActualConnectionsSnapshot {
  /**
   * True when registered ids were loaded successfully, making absence from
   * `connections` authoritative. False means the snapshot only covers live
   * stats, so dormant/hibernated connections may be missing from the map.
   */
  complete: boolean;
  /** connectionId → gateway status, or null for registered-only (pruned) ids. */
  connections: Map<string, string | null>;
}

/** What one host's drain phase removed, carried into its connect-phase log line. */
export interface HostDrainCounts {
  gatedDisconnected: number;
  gatedSize: number;
  stale: number;
}
