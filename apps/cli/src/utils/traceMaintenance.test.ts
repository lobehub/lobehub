import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ExecutionSnapshot, ISnapshotStore, SnapshotSummary } from '@lobechat/agent-tracing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pruneOldTraces, reconcileOrphanTraces } from './traceMaintenance';

class MemoryStore implements ISnapshotStore {
  partials = new Map<string, Partial<ExecutionSnapshot>>();
  saved: ExecutionSnapshot[] = [];

  async get() {
    return null;
  }
  async getLatest() {
    return null;
  }
  async list(): Promise<SnapshotSummary[]> {
    return [];
  }
  async listPartials() {
    return [...this.partials.keys()].map((id) => `${id}.json`);
  }
  async loadPartial(operationId: string) {
    return this.partials.get(operationId) ?? null;
  }
  async removePartial(operationId: string) {
    this.partials.delete(operationId);
  }
  async save(snapshot: ExecutionSnapshot) {
    this.saved.push(snapshot);
  }
  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>) {
    this.partials.set(operationId, partial);
  }
}

const NOW = 10_000_000;
const HOUR = 60 * 60 * 1000;

describe('reconcileOrphanTraces', () => {
  it('closes a partial whose last step is older than the idle window', async () => {
    const store = new MemoryStore();
    store.partials.set('op_dead', {
      operationId: 'op_dead',
      startedAt: NOW - 12 * HOUR,
      steps: [{ completedAt: NOW - 10 * HOUR } as any],
    });

    const reconciled = await reconcileOrphanTraces(store, { now: NOW });

    expect(reconciled).toBe(1);
    expect(store.saved[0]).toMatchObject({
      completionReason: 'interrupted',
      operationId: 'op_dead',
    });
    // The partial is consumed, so it is never reconciled twice.
    expect(store.partials.has('op_dead')).toBe(false);
  });

  it('reports the tokens the killed run did spend, not zero', async () => {
    const store = new MemoryStore();
    store.partials.set('op_dead', {
      operationId: 'op_dead',
      startedAt: NOW - 12 * HOUR,
      steps: [
        { completedAt: NOW - 11 * HOUR, totalTokens: 1200 } as any,
        { completedAt: NOW - 10 * HOUR, totalTokens: 800 } as any,
      ],
    });

    await reconcileOrphanTraces(store, { now: NOW });

    // `result_usage` never arrived, so the session total is the sum of turns.
    expect(store.saved[0].totalTokens).toBe(2000);
  });

  it('leaves a partial that is still being written alone', async () => {
    const store = new MemoryStore();
    store.partials.set('op_live', {
      operationId: 'op_live',
      startedAt: NOW - 12 * HOUR,
      // A long-running agent: started hours ago, but stepped a minute ago.
      steps: [{ completedAt: NOW - 60_000 } as any],
    });

    expect(await reconcileOrphanTraces(store, { now: NOW })).toBe(0);
    expect(store.partials.has('op_live')).toBe(true);
    expect(store.saved).toHaveLength(0);
  });

  it('falls back to startedAt for a partial that never recorded a step', async () => {
    const store = new MemoryStore();
    store.partials.set('op_stillborn', { operationId: 'op_stillborn', startedAt: NOW - 12 * HOUR });

    expect(await reconcileOrphanTraces(store, { now: NOW })).toBe(1);
  });
});

describe('pruneOldTraces', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-prune-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { force: true, recursive: true });
  });

  it('deletes snapshots past the retention window and keeps recent ones', async () => {
    const old = path.join(dir, '2020-01-01_old.json');
    const recent = path.join(dir, '2026-01-01_recent.json');
    await fs.writeFile(old, '{}');
    await fs.writeFile(recent, '{}');
    const staleTime = new Date(Date.now() - 30 * 24 * HOUR);
    await fs.utimes(old, staleTime, staleTime);

    expect(await pruneOldTraces({ dir, maxAgeMs: 14 * 24 * HOUR })).toBe(1);
    expect(await fs.readdir(dir)).toEqual(['2026-01-01_recent.json']);
  });

  it('ignores the latest symlink and non-snapshot files', async () => {
    await fs.writeFile(path.join(dir, 'keep.json'), '{}');
    await fs.symlink('keep.json', path.join(dir, 'latest.json'));
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x');

    // `now` is pinned ahead of the writes: `mtimeMs` carries sub-millisecond
    // precision, so a freshly written file can read as marginally newer than an
    // integer `Date.now()` and survive a zero-length window.
    expect(await pruneOldTraces({ dir, maxAgeMs: 0, now: Date.now() + 60_000 })).toBe(1);
    expect((await fs.readdir(dir)).sort()).toEqual(['latest.json', 'notes.txt']);
  });

  it('returns 0 when the trace directory does not exist yet', async () => {
    expect(await pruneOldTraces({ dir: path.join(dir, 'missing') })).toBe(0);
  });
});
