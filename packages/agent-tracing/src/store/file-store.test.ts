import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { FileSnapshotStore } from './file-store';

let root: string;

const snapshot = (traceId: string): ExecutionSnapshot => ({
  operationId: traceId,
  startedAt: Date.now(),
  steps: [],
  totalCost: 0,
  totalSteps: 0,
  totalTokens: 0,
  traceId,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-store-'));
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe('FileSnapshotStore', () => {
  it('defaults to a .agent-tracing directory under the root', async () => {
    await new FileSnapshotStore(root).save(snapshot('trace_default'));

    const entries = await fs.readdir(path.join(root, '.agent-tracing'));
    expect(entries.some((entry) => entry.includes('trace_defau'))).toBe(true);
  });

  it('honours a custom directory name so a host can own its own layout', async () => {
    const store = new FileSnapshotStore(root, 'traces');
    await store.save(snapshot('trace_custom'));

    const entries = await fs.readdir(path.join(root, 'traces'));
    expect(entries.some((entry) => entry.includes('trace_custo'))).toBe(true);
    // And nothing leaked into the default location.
    await expect(fs.readdir(path.join(root, '.agent-tracing'))).rejects.toThrow();
    expect(await store.get('trace_custom')).toMatchObject({ traceId: 'trace_custom' });
  });

  it('writes partials atomically, leaving no temp file behind', async () => {
    const store = new FileSnapshotStore(root, 'traces');
    await store.savePartial('op_1', { operationId: 'op_1', steps: [] });

    const entries = await fs.readdir(path.join(root, 'traces', '_partial'));
    expect(entries).toEqual(['op_1.json']);
    expect(await store.loadPartial('op_1')).toMatchObject({ operationId: 'op_1' });
  });

  it('still saves the snapshot when the latest symlink cannot be written', async () => {
    const store = new FileSnapshotStore(root, 'traces');
    await store.save(snapshot('trace_a'));

    // A directory at `latest.json` makes both unlink and symlink fail — the
    // stand-in for two runs racing on the pointer. The snapshot must survive.
    await fs.rm(path.join(root, 'traces', 'latest.json'));
    await fs.mkdir(path.join(root, 'traces', 'latest.json'));

    await expect(store.save(snapshot('trace_b'))).resolves.toBeUndefined();
    expect(await store.get('trace_b')).toMatchObject({ traceId: 'trace_b' });
  });
});
