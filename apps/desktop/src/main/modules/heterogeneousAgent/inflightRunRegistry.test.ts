import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HETERO_INFLIGHT_RUN_MAX_AGE_MS,
  HETERO_INFLIGHT_RUN_MAX_CLAIMS,
  type HeteroInflightRun,
  HeteroInflightRunRegistry,
} from './inflightRunRegistry';

// Claims are judged against a fixed clock: `startedAt` is pinned, so the real
// `Date.now()` would age every fixture past the max age a few days later.
const NOW = Date.parse('2026-09-21T10:00:00.000Z');

const run = (ipcSessionId: string, extra?: Partial<HeteroInflightRun>): HeteroInflightRun => ({
  agentType: 'claude-code',
  ipcSessionId,
  operationId: `op-${ipcSessionId}`,
  startedAt: new Date('2026-09-21T02:00:00.000Z').toISOString(),
  topicId: 'topic-1',
  ...extra,
});

describe('HeteroInflightRunRegistry', () => {
  let dir: string;
  let filePath: string;
  let registry: HeteroInflightRunRegistry;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'hetero-inflight-'));
    filePath = path.join(dir, 'nested', 'inflight-runs.json');
    registry = new HeteroInflightRunRegistry(filePath);
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('starts empty when the file does not exist', () => {
    expect(registry.list()).toEqual([]);
  });

  it('persists upserts across instances and creates parent directories', () => {
    registry.upsert(run('s1', { pid: 123 }));
    registry.upsert(run('s2'));

    const reloaded = new HeteroInflightRunRegistry(filePath);
    expect(reloaded.list().map((r) => r.ipcSessionId)).toEqual(['s1', 's2']);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('replaces an existing entry on upsert and merges on patch', () => {
    registry.upsert(run('s1'));
    registry.upsert(run('s1', { pid: 9 }));
    registry.patch('s1', { agentSessionId: 'cc-session' });
    registry.patch('missing', { agentSessionId: 'ignored' });

    expect(registry.list()).toEqual([
      expect.objectContaining({ agentSessionId: 'cc-session', ipcSessionId: 's1', pid: 9 }),
    ]);
  });

  it('removes only the named entry', () => {
    registry.upsert(run('s1'));
    registry.upsert(run('s2'));
    registry.remove('s1');
    registry.remove('s1');

    expect(registry.list().map((r) => r.ipcSessionId)).toEqual(['s2']);
  });

  it('keeps a claimed run on the ledger until it is released', () => {
    registry.upsert(run('s1'));

    // The renderer still has to reap, replay and settle; a crash before that
    // would otherwise leave the topic with no token to retry it.
    const claimed = registry.claim(run('s1'), NOW);
    expect(claimed.claimCount).toBe(1);
    expect(claimed.expired).toBeUndefined();
    expect(registry.list()).toEqual([
      expect.objectContaining({ claimCount: 1, ipcSessionId: 's1' }),
    ]);

    registry.release('s1');
    expect(registry.list()).toEqual([]);
  });

  it('spends a run that keeps being claimed without ever being released', () => {
    registry.upsert(run('s1'));

    let entry = registry.list()[0];
    for (let index = 1; index < HETERO_INFLIGHT_RUN_MAX_CLAIMS; index++) {
      entry = registry.claim(entry, NOW);
      expect(entry.expired).toBeUndefined();
      entry = registry.list()[0];
    }

    // The last handover is status-only cleanup, and the entry goes with it.
    expect(registry.claim(entry, NOW)).toMatchObject({ expired: true });
    expect(registry.list()).toEqual([]);
  });

  it('claim flags stale runs and drops them, leaving fresh ones in place', () => {
    registry.upsert(run('fresh'));
    registry.upsert(
      run('stale', {
        startedAt: new Date(NOW - HETERO_INFLIGHT_RUN_MAX_AGE_MS - 1000).toISOString(),
      }),
    );
    registry.upsert(run('broken', { startedAt: 'not-a-date' }));

    // An expired entry still comes back: its topic may be parked mid-run and
    // the stale-topic watchdog only ever looks at `running`.
    const claimed = registry.list().map((entry) => registry.claim(entry, NOW));
    expect(claimed.map((r) => [r.ipcSessionId, r.expired ?? false])).toEqual([
      ['fresh', false],
      ['stale', true],
      ['broken', true],
    ]);
    expect(registry.list().map((r) => r.ipcSessionId)).toEqual(['fresh']);
  });

  it('treats an unreadable file as empty instead of throwing', () => {
    writeFileSync(path.join(dir, 'corrupt.json'), '{not json');
    const corrupt = new HeteroInflightRunRegistry(path.join(dir, 'corrupt.json'));

    expect(corrupt.list()).toEqual([]);
    corrupt.upsert(run('s1'));
    expect(corrupt.list()).toHaveLength(1);
  });
});
