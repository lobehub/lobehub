import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { BinaryManager, type BinaryStatus } from '@/core/infrastructure/BinaryManager';

import BinaryCtr from '../BinaryCtr';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('BinaryCtr', () => {
  let cacheRoot: string;

  beforeEach(async () => {
    cacheRoot = await mkdtemp(path.join(os.tmpdir(), 'lobehub-binary-ctr-'));
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockReturnValue(cacheRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cacheRoot, { force: true, recursive: true });
  });

  it('hands a refreshed default CLI status to the immediate launch preflight', async () => {
    let detectedStatus: BinaryStatus = { available: false };
    const detectSpec = vi.fn(async () => detectedStatus);
    const manager = new BinaryManager({} as App);
    manager.register({ detect: detectSpec, name: 'codex' }, 'cli-agents');

    // Seed the same stale negative entry that a launch would otherwise reuse.
    await expect(manager.detect('codex')).resolves.toMatchObject({ available: false });

    detectedStatus = {
      available: true,
      path: '/Users/test/.local/bin/codex',
      version: '1.2.3',
    };
    const controller = new BinaryCtr({ binaryManager: manager } as App);

    await expect(
      controller.detectHeterogeneousAgentCommand({ agentType: 'codex', command: 'codex' }),
    ).resolves.toMatchObject(detectedStatus);

    // HeterogeneousAgent launch calls this non-forced path. It must receive the
    // rescan result without probing again or falling back to the stale entry.
    await expect(manager.detect('codex')).resolves.toMatchObject(detectedStatus);
    expect(detectSpec).toHaveBeenCalledTimes(2);
  });
});
