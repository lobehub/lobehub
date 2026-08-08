import type * as ChildProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';

const spawnSpy = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  spawnSpy.mockImplementation(actual.spawn);
  return { ...actual, spawn: spawnSpy };
});

describe('runCommand spawn options', () => {
  let processManager: ShellProcessManager;
  let tmpDir: string;

  beforeEach(() => {
    spawnSpy.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-shell-spawn-options-'));
    processManager = new ShellProcessManager(tmpDir);
  });

  afterEach(() => {
    processManager.cleanupAll();
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('should hide the console window spawned for the shell on Windows', async () => {
    const result = await runCommand({ command: 'echo hidden' }, { processManager });

    expect(result.success).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });
});
