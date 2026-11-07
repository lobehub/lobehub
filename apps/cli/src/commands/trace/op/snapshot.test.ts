import { type ExecutionSnapshot, FileSnapshotStore } from '@lobechat/agent-tracing';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadLocalSnapshot } from './snapshot';

let root: string;
let cliHome: { dirName: string; rootDir: string };
let cwd: { dirName: string; rootDir: string };

const snapshot = (traceId: string, startedAt: number): ExecutionSnapshot => ({
  operationId: traceId,
  startedAt,
  steps: [],
  totalCost: 0,
  totalSteps: 0,
  totalTokens: 0,
  traceId,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-resolve-'));
  cliHome = { dirName: 'traces', rootDir: path.join(root, 'home') };
  cwd = { dirName: '.agent-tracing', rootDir: path.join(root, 'repo') };
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

const write = async (
  store: { dirName: string; rootDir: string },
  traceId: string,
  startedAt: number,
) => new FileSnapshotStore(store.rootDir, store.dirName).save(snapshot(traceId, startedAt));

describe('loadLocalSnapshot', () => {
  it('picks the newest run across both stores for the default target', async () => {
    await write(cliHome, 'trace_hetero_old', 1_000);
    await write(cwd, 'trace_server_new', 9_000);

    // The dev-mode server's store holds the newer run — resolving `latest` from
    // the CLI home alone would inspect the stale one while `lh trace op list`
    // shows the newer one first.
    const resolved = await loadLocalSnapshot(undefined, { cliHome, cwd });
    expect(resolved?.traceId).toBe('trace_server_new');
  });

  it('picks the CLI-home run when it is the newer of the two', async () => {
    await write(cliHome, 'trace_hetero_new', 9_000);
    await write(cwd, 'trace_server_old', 1_000);

    expect((await loadLocalSnapshot('latest', { cliHome, cwd }))?.traceId).toBe(
      'trace_hetero_new',
    );
  });

  it('falls back to whichever store has anything at all', async () => {
    await write(cwd, 'trace_only', 1_000);
    expect((await loadLocalSnapshot(undefined, { cliHome, cwd }))?.traceId).toBe('trace_only');

    await fs.rm(path.join(cwd.rootDir), { force: true, recursive: true });
    await write(cliHome, 'trace_other', 2_000);
    expect((await loadLocalSnapshot(undefined, { cliHome, cwd }))?.traceId).toBe('trace_other');
  });

  it('resolves an explicit id from either store', async () => {
    await write(cliHome, 'trace_in_home', 1_000);
    await write(cwd, 'trace_in_cwd', 9_000);

    expect((await loadLocalSnapshot('trace_in_home', { cliHome, cwd }))?.traceId).toBe(
      'trace_in_home',
    );
    expect((await loadLocalSnapshot('trace_in_cwd', { cliHome, cwd }))?.traceId).toBe(
      'trace_in_cwd',
    );
  });

  it('returns undefined when neither store has anything', async () => {
    expect(await loadLocalSnapshot(undefined, { cliHome, cwd })).toBeUndefined();
  });
});
