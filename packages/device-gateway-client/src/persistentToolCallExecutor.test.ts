import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistentToolCallExecutor } from './persistentToolCallExecutor';

describe('PersistentToolCallExecutor', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'device-tool-calls-'));
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('persists the request before executing and joins concurrent duplicates', async () => {
    const executor = new PersistentToolCallExecutor<{ content: string }>(directory);
    let release: (() => void) | undefined;
    const run = vi.fn(async () => {
      const entries = await readdir(directory);
      expect(entries).toHaveLength(1);
      expect(
        JSON.parse(await readFile(path.join(directory, entries[0], 'request.json'), 'utf8')),
      ).toMatchObject({ requestId: 'request-1' });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { content: 'done' };
    });

    const first = executor.execute('request-1', run);
    const second = executor.execute('request-1', run);
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { result: { content: 'done' }, status: 'completed' },
      { result: { content: 'done' }, status: 'completed' },
    ]);
    expect(run).toHaveBeenCalledOnce();
  });

  it('replays a result from disk in a new executor instance', async () => {
    const first = new PersistentToolCallExecutor<{ content: string }>(directory);
    await first.execute('request-1', async () => ({ content: 'persisted' }));

    const run = vi.fn(async () => ({ content: 'duplicate' }));
    const restarted = new PersistentToolCallExecutor<{ content: string }>(directory);
    await expect(restarted.execute('request-1', run)).resolves.toEqual({
      result: { content: 'persisted' },
      status: 'completed',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('waits for an active owner in another executor instance', async () => {
    const first = new PersistentToolCallExecutor<{ content: string }>(directory);
    const second = new PersistentToolCallExecutor<{ content: string }>(directory);
    let release: (() => void) | undefined;
    const firstExecution = first.execute('request-1', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { content: 'persisted' };
    });
    await vi.waitFor(() => expect(release).toBeDefined());

    const duplicateRun = vi.fn(async () => ({ content: 'duplicate' }));
    const processKillSpy = vi.spyOn(process, 'kill');
    const duplicateExecution = second.execute('request-1', duplicateRun);
    await vi.waitFor(() => expect(processKillSpy).toHaveBeenCalledWith(process.pid, 0));
    processKillSpy.mockRestore();
    release?.();

    await expect(Promise.all([firstExecution, duplicateExecution])).resolves.toEqual([
      { result: { content: 'persisted' }, status: 'completed' },
      { result: { content: 'persisted' }, status: 'completed' },
    ]);
    expect(duplicateRun).not.toHaveBeenCalled();
  });

  it('marks a thrown execution as outcome_unknown for later attempts', async () => {
    const first = new PersistentToolCallExecutor<{ content: string }>(directory);
    await expect(
      first.execute('request-1', async () => {
        throw new Error('execution failed');
      }),
    ).rejects.toThrow('execution failed');

    const run = vi.fn(async () => ({ content: 'duplicate' }));
    const restarted = new PersistentToolCallExecutor<{ content: string }>(directory);
    await expect(restarted.execute('request-1', run)).resolves.toEqual({
      status: 'outcome_unknown',
    });
    expect(run).not.toHaveBeenCalled();
  });
});
