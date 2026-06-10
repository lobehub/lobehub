import { afterEach, describe, expect, it, vi } from 'vitest';

interface DevProcessHandle {
  directPid?: number;
  groupPid?: number;
  isWindows: boolean;
}

interface DevStartupTestingExports {
  __testing: {
    createDevProcessHandle: (params: { isWindows: boolean; pid?: number }) => DevProcessHandle;
    sendSignalToDevProcess: (handle: DevProcessHandle | undefined, signal: NodeJS.Signals) => void;
  };
}

const loadTestingExports = async () => {
  const modulePath = '../../scripts/devStartupSequence' + '.mts';
  return (await import(modulePath)) as unknown as DevStartupTestingExports;
};

describe('devProcessCleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should save the detached process group pid on Unix', async () => {
    const { createDevProcessHandle } = (await loadTestingExports()).__testing;

    expect(createDevProcessHandle({ isWindows: false, pid: 1234 })).toEqual({
      directPid: 1234,
      groupPid: 1234,
      isWindows: false,
    });
  });

  it('should signal the saved process group without requiring the direct child to be alive', async () => {
    const { sendSignalToDevProcess } = (await loadTestingExports()).__testing;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    sendSignalToDevProcess(
      {
        directPid: 1234,
        groupPid: 1234,
        isWindows: false,
      },
      'SIGTERM',
    );

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
  });

  it('should fall back to the direct child pid when the process group is already gone', async () => {
    const { sendSignalToDevProcess } = (await loadTestingExports()).__testing;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid < 0) throw new Error('missing process group');
      return true;
    });

    sendSignalToDevProcess(
      {
        directPid: 1234,
        groupPid: 1234,
        isWindows: false,
      },
      'SIGKILL',
    );

    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenNthCalledWith(1, -1234, 'SIGKILL');
    expect(kill).toHaveBeenNthCalledWith(2, 1234, 'SIGKILL');
  });

  it('should signal only the direct child pid on Windows', async () => {
    const { createDevProcessHandle, sendSignalToDevProcess } = (await loadTestingExports())
      .__testing;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    sendSignalToDevProcess(createDevProcessHandle({ isWindows: true, pid: 1234 }), 'SIGTERM');

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
  });
});
