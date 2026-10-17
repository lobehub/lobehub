import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('probes the user-installed dsh CLI instead of assuming DeepSeek Harness is present', async () => {
    const controller = new BinaryCtr({} as App);
    const dsh = path.join(cacheRoot, 'dsh');
    await writeFile(dsh, '#!/bin/sh\necho 0.2.0-rc.2\n');
    await chmod(dsh, 0o755);

    await expect(
      controller.detectHeterogeneousAgentCommand({ agentType: 'deepseek-harness', command: dsh }),
    ).resolves.toMatchObject({ available: true, version: '0.2.0-rc.2' });
    await expect(
      controller.detectHeterogeneousAgentCommand({
        agentType: 'deepseek-harness',
        command: path.join(cacheRoot, 'missing-dsh'),
      }),
    ).resolves.toMatchObject({ available: false });
  });

  it('reports an installed dsh without the acp profile as needing an update', async () => {
    const controller = new BinaryCtr({} as App);
    const dsh = path.join(cacheRoot, 'dsh');
    await writeFile(dsh, '#!/bin/sh\necho 0.0.1\n');
    await chmod(dsh, 0o755);

    await expect(
      controller.detectHeterogeneousAgentCommand({ agentType: 'deepseek-harness', command: dsh }),
    ).resolves.toMatchObject({
      available: false,
      error: expect.stringMatching(/0\.0\.1 is too old.*npm i -g @deepseek-ai\/dsh/),
    });
  });
});
