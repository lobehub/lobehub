import type * as ChildProcessModule from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forceKillProcessTree, parseDescendantPids } from './processTree';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  spawn: spawnMock,
}));

const PS = `
    1     0
  100     1
  200   100
  201   100
  300   200
  999     1
`;

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('parseDescendantPids', () => {
  it('walks the whole subtree and nothing else', () => {
    expect(parseDescendantPids(PS, 100)).toEqual([200, 201, 300]);
    expect(parseDescendantPids(PS, 300)).toEqual([]);
  });
});

describe('forceKillProcessTree', () => {
  it('SIGKILLs the root and every descendant listed before it dies on POSIX', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    forceKillProcessTree(100, { listPs: () => PS, platform: 'linux' });

    expect(kill.mock.calls).toEqual([
      [100, 'SIGKILL'],
      [200, 'SIGKILL'],
      [201, 'SIGKILL'],
      [300, 'SIGKILL'],
    ]);
  });

  it('still kills the root when ps is unavailable', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    forceKillProcessTree(100, {
      listPs: () => {
        throw new Error('ENOENT');
      },
      platform: 'darwin',
    });

    expect(kill.mock.calls).toEqual([[100, 'SIGKILL']]);
  });

  it('uses taskkill /T /F on Windows', () => {
    spawnMock.mockReturnValue({ once: vi.fn() });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    forceKillProcessTree(4242, { platform: 'win32' });

    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/pid', '4242', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(kill).not.toHaveBeenCalled();
  });
});
