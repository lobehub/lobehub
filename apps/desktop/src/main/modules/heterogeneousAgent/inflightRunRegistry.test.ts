import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HETERO_INFLIGHT_RUN_MAX_AGE_MS,
  type HeteroInflightRun,
  HeteroInflightRunRegistry,
} from './inflightRunRegistry';

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
    expect(registry.takeAll()).toEqual([]);
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

  it('takeAll flags stale runs instead of dropping them', () => {
    const now = Date.parse('2026-09-21T10:00:00.000Z');
    registry.upsert(run('fresh'));
    registry.upsert(
      run('stale', {
        startedAt: new Date(now - HETERO_INFLIGHT_RUN_MAX_AGE_MS - 1000).toISOString(),
      }),
    );
    registry.upsert(run('broken', { startedAt: 'not-a-date' }));

    // An expired entry still comes back: its topic may be parked mid-run and
    // the stale-topic watchdog only ever looks at `running`.
    const taken = registry.takeAll(now);
    expect(taken.map((r) => [r.ipcSessionId, r.expired ?? false])).toEqual([
      ['fresh', false],
      ['stale', true],
      ['broken', true],
    ]);
    expect(registry.list()).toEqual([]);
    expect(registry.takeAll(now)).toEqual([]);
  });

  it('treats an unreadable file as empty instead of throwing', () => {
    writeFileSync(path.join(dir, 'corrupt.json'), '{not json');
    const corrupt = new HeteroInflightRunRegistry(path.join(dir, 'corrupt.json'));

    expect(corrupt.list()).toEqual([]);
    corrupt.upsert(run('s1'));
    expect(corrupt.list()).toHaveLength(1);
  });
});
