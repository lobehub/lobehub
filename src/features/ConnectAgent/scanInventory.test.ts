import { describe, expect, it } from 'vitest';

import { CONNECTABLE_PROVIDERS } from './providers';
import { buildScanInventory } from './scanInventory';
import type { AgentScanState } from './useAgentScan';

const providers = CONNECTABLE_PROVIDERS.slice(0, 4);
const [a, b, c, d] = providers.map((provider) => provider.type);

const rows = (state: AgentScanState) =>
  buildScanInventory(state, providers).inventory.map((row) => row.provider.type);

describe('buildScanInventory', () => {
  it('lists nothing before a scan or when it failed', () => {
    expect(buildScanInventory({ agents: null, status: 'idle' }, providers)).toEqual({
      detectedCount: 0,
      inventory: [],
      pendingCount: 0,
    });
    expect(
      buildScanInventory({ agents: null, error: 'offline', status: 'error' }, providers).inventory,
    ).toEqual([]);
  });

  it('shows only settled agents while scanning and counts the rest as pending', () => {
    const state: AgentScanState = {
      agents: { [c]: { available: true, version: '1.0.0' } },
      settled: [c],
      status: 'scanning',
    };

    expect(buildScanInventory(state, providers)).toEqual({
      detectedCount: 1,
      inventory: [{ provider: providers[2], status: { available: true, version: '1.0.0' } }],
      pendingCount: 3,
    });
  });

  it('keeps detected rows on top in arrival order so earlier rows never move', () => {
    const before: AgentScanState = {
      agents: { [b]: { available: false }, [d]: { available: true } },
      settled: [b, d],
      status: 'scanning',
    };
    expect(rows(before)).toEqual([d, b]);

    // A later detection lands below the detected row already shown
    const after: AgentScanState = {
      agents: { ...before.agents, [a]: { available: true } },
      settled: [b, d, a],
      status: 'scanning',
    };
    expect(rows(after)).toEqual([d, a, b]);
  });

  it('keeps the scanning order once the scan finishes', () => {
    const agents = {
      [a]: { available: true },
      [b]: { available: false },
      [c]: { available: false },
      [d]: { available: true },
    };
    const settled = [c, d, b, a];

    expect(rows({ agents, settled, status: 'scanning' })).toEqual(
      rows({ agents, settled, status: 'success' }),
    );
    expect(buildScanInventory({ agents, settled, status: 'success' }, providers)).toMatchObject({
      detectedCount: 2,
      pendingCount: 0,
    });
  });

  it('falls back to provider order when the scan ran elsewhere', () => {
    expect(
      rows({ agents: { [a]: { available: false }, [c]: { available: true } }, status: 'success' }),
    ).toEqual([c, a, b, d]);
  });

  it('shows a settled type the host does not know as not detected', () => {
    const { detectedCount, inventory, pendingCount } = buildScanInventory(
      { agents: {}, settled: [b], status: 'scanning' },
      providers,
    );

    expect(inventory).toEqual([{ provider: providers[1], status: undefined }]);
    expect({ detectedCount, pendingCount }).toEqual({ detectedCount: 0, pendingCount: 3 });
  });
});
