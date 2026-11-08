import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChildProcessBackend } from './child-process-backend';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
});

describe('physical shell termination', () => {
  it('does not acknowledge an unknown shell', async () => {
    expect(await new ChildProcessBackend().terminate('missing')).toBe(false);
  });

  it('does not equate a closed Windows parent with an exited process tree', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    const child = Object.assign(new EventEmitter(), {
      exitCode: 0,
      pid: 12345,
      signalCode: null,
    });
    const backend = new ChildProcessBackend(vi.fn(() => child) as unknown as typeof spawn);
    backend.spawn(
      { cmd: 'command', args: [] },
      {
        env: {},
        outputFiles: { stderr: { fd: 2, path: '' }, stdout: { fd: 1, path: '' } },
        shellId: 'closed-parent',
      },
    );
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Parent is gone'), { code: 'ESRCH' });
    });
    child.emit('close', 0);
    expect(await backend.terminate('closed-parent')).toBe(false);
  });
});
