import { beforeEach, describe, expect, it, vi } from 'vitest';

import { after } from '@/server/utils/scheduleAfterResponse';

import {
  buildLastSyncedAtMap,
  CONNECTOR_TOOLS_REFRESH_TTL_MS,
  scheduleStaleConnectorToolsRefresh,
} from './refresh';
import { syncConnectorToolsById } from './sync';

// Capture deferred work instead of running it, so each test controls exactly
// when (and whether) the background refresh executes.
const deferred: Array<() => Promise<unknown>> = [];
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: vi.fn((work: () => Promise<unknown>) => {
    deferred.push(work);
  }),
}));
vi.mock('./sync', () => ({ syncConnectorToolsById: vi.fn().mockResolvedValue({ toolCount: 3 }) }));

const ctx = {} as any;
const NOW = 1_000_000_000_000;

// Unique connector id per test keeps the module-level in-flight guard isolated
// across tests (a fresh id is never "in flight" from a previous test).
let seq = 0;
const nextId = () => `conn-${seq++}`;

const httpConnector = (id: string) => ({
  id,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
});

/** Run and await all currently-captured deferred works. */
const flushDeferred = async () => {
  const works = deferred.splice(0);
  for (const work of works) await work();
};

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  vi.mocked(syncConnectorToolsById).mockResolvedValue({ toolCount: 3 });
});

describe('buildLastSyncedAtMap', () => {
  it('keeps the max updatedAt per connector', () => {
    const map = buildLastSyncedAtMap([
      { updatedAt: new Date(100), userConnectorId: 'a' },
      { updatedAt: new Date(300), userConnectorId: 'a' },
      { updatedAt: new Date(200), userConnectorId: 'b' },
    ]);
    expect(map.get('a')).toBe(300);
    expect(map.get('b')).toBe(200);
  });

  it('treats a missing/null updatedAt as 0', () => {
    const map = buildLastSyncedAtMap([{ updatedAt: null, userConnectorId: 'a' }]);
    expect(map.get('a')).toBe(0);
  });

  it('returns an empty map for no tools', () => {
    expect(buildLastSyncedAtMap([]).size).toBe(0);
  });
});

describe('scheduleStaleConnectorToolsRefresh — eligibility', () => {
  it('schedules a refresh for an HTTP connector whose tools are stale', async () => {
    const id = nextId();
    const lastSynced = NOW - CONNECTOR_TOOLS_REFRESH_TTL_MS - 1;
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map([[id, lastSynced]]), ctx, NOW);

    expect(after).toHaveBeenCalledTimes(1);
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledWith(id, ctx);
  });

  it('schedules a refresh for a connector that has never synced (no map entry)', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);

    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledWith(id, ctx);
  });

  it('skips a connector synced within the TTL', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map([[id, NOW - 1000]]), ctx, NOW);

    expect(after).not.toHaveBeenCalled();
    await flushDeferred();
    expect(syncConnectorToolsById).not.toHaveBeenCalled();
  });

  it('skips stdio connectors (must run on the user machine, not the server)', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh(
      [{ id, mcpConnectionType: 'stdio', mcpServerUrl: null }],
      new Map(),
      ctx,
      NOW,
    );
    await flushDeferred();
    expect(syncConnectorToolsById).not.toHaveBeenCalled();
  });

  it('skips connectors without an HTTP endpoint', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh(
      [{ id, mcpConnectionType: 'http', mcpServerUrl: null }],
      new Map(),
      ctx,
      NOW,
    );
    await flushDeferred();
    expect(syncConnectorToolsById).not.toHaveBeenCalled();
  });

  it('throttles a second call for the same connector at the same instant', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    // Second call at the same `now` → within TTL of the recorded attempt → skipped.
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);

    expect(after).toHaveBeenCalledTimes(1);
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(1);
  });

  it('keeps throttling a connector whose upstream tool list is empty', async () => {
    // Empty upstream list → no tool row records the sync → DB marker stays 0.
    // The in-memory attempt marker must still honor the TTL so it does not
    // re-fire on every run.
    const id = nextId();
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    await flushDeferred();
    // Later, but still within the TTL, with an empty DB marker again → skipped.
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW + 1000);
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleStaleConnectorToolsRefresh — remote result handling', () => {
  it('completes cleanly when the remote sync succeeds', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    await expect(flushDeferred()).resolves.toBeUndefined();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(1);
  });

  it('swallows a remote sync failure (never rejects, never surfaces)', async () => {
    const id = nextId();
    vi.mocked(syncConnectorToolsById).mockRejectedValueOnce(new Error('remote MCP down'));
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    // The deferred work must resolve, not reject, even though the sync failed.
    await expect(flushDeferred()).resolves.toBeUndefined();
  });

  it('re-syncs once the TTL has elapsed since the last attempt', async () => {
    const id = nextId();
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    await flushDeferred();
    // Past the TTL → eligible again even though the DB marker never advanced.
    scheduleStaleConnectorToolsRefresh(
      [httpConnector(id)],
      new Map(),
      ctx,
      NOW + CONNECTOR_TOOLS_REFRESH_TTL_MS + 1,
    );
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(2);
  });

  it('backs off a failed connector for a TTL, then retries', async () => {
    const id = nextId();
    vi.mocked(syncConnectorToolsById).mockRejectedValueOnce(new Error('remote MCP down'));
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    await flushDeferred();

    // Within the TTL after a failure → still backed off, not retried.
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW + 1000);
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(1);

    // After the TTL → retried, and this time it succeeds.
    vi.mocked(syncConnectorToolsById).mockResolvedValueOnce({ toolCount: 5 });
    scheduleStaleConnectorToolsRefresh(
      [httpConnector(id)],
      new Map(),
      ctx,
      NOW + CONNECTOR_TOOLS_REFRESH_TTL_MS + 1,
    );
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(2);
  });
});

describe('scheduleStaleConnectorToolsRefresh — never throws into the caller', () => {
  it('does not throw when the sync throws synchronously', async () => {
    const id = nextId();
    vi.mocked(syncConnectorToolsById).mockImplementationOnce(() => {
      throw new Error('sync exploded synchronously');
    });
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    await expect(flushDeferred()).resolves.toBeUndefined();
  });

  it('does not throw when after() itself throws, and frees the guard for retry', async () => {
    const id = nextId();
    vi.mocked(after).mockImplementationOnce(() => {
      throw new Error('scheduling failed');
    });
    expect(() =>
      scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW),
    ).not.toThrow();
    expect(syncConnectorToolsById).not.toHaveBeenCalled();

    // Guard was released despite the scheduling failure → next call schedules.
    scheduleStaleConnectorToolsRefresh([httpConnector(id)], new Map(), ctx, NOW);
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledTimes(1);
  });

  it('processes remaining connectors even if one entry is malformed', async () => {
    const goodId = nextId();
    // A null entry would throw on property access — the per-item guard must
    // catch it and still schedule the healthy connector.
    scheduleStaleConnectorToolsRefresh([null as any, httpConnector(goodId)], new Map(), ctx, NOW);
    await flushDeferred();
    expect(syncConnectorToolsById).toHaveBeenCalledWith(goodId, ctx);
  });
});
