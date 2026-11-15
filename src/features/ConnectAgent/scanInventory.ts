import type {
  HeterogeneousAgentScanStatus,
  HeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';

import type { ConnectableProvider } from './providers';
import { CONNECTABLE_PROVIDERS } from './providers';
import type { AgentScanState } from './useAgentScan';

export interface ScanInventoryRow {
  provider: ConnectableProvider;
  status?: HeterogeneousAgentScanStatus;
}

export interface ScanInventory {
  /** Agents detected on the target. */
  detectedCount: number;
  /** Rows to render, in display order. */
  inventory: ScanInventoryRow[];
  /** Probes still in flight — rendered as skeleton rows below the inventory. */
  pendingCount: number;
}

const EMPTY: ScanInventory = { detectedCount: 0, inventory: [], pendingCount: 0 };

/**
 * The connect wizard's agent list for a scan state. While scanning it holds
 * only the agents whose probe has settled, so the list grows row by row.
 *
 * Order: detected agents first, then by arrival. A later detection therefore
 * lands below the detected rows already shown — a row the user is about to
 * click never moves — and the finished scan keeps the order it was built in.
 * Without an arrival order (another surface ran the scan) rows follow the
 * provider order.
 */
export const buildScanInventory = (
  scanState: AgentScanState,
  providers: ConnectableProvider[] = CONNECTABLE_PROVIDERS,
): ScanInventory => {
  const scanning = scanState.status === 'scanning';
  if (!scanning && (scanState.status !== 'success' || !scanState.agents)) return EMPTY;

  const settled = scanState.settled ?? [];
  const arrival = (type: HeterogeneousAgentType) => {
    const index = settled.indexOf(type);
    return index === -1 ? settled.length + providers.length : index;
  };
  const rank = (status?: HeterogeneousAgentScanStatus) => (status?.available ? 0 : 1);

  const inventory = providers
    .filter((provider) => !scanning || settled.includes(provider.type))
    .map((provider) => ({ provider, status: scanState.agents?.[provider.type] }))
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) || arrival(a.provider.type) - arrival(b.provider.type),
    );

  return {
    detectedCount: inventory.filter((row) => row.status?.available).length,
    inventory,
    pendingCount: scanning ? providers.length - inventory.length : 0,
  };
};
