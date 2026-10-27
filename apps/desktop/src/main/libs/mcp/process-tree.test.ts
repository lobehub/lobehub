import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  reapOrphanedProcessGroup,
  signalProcessTree,
  terminatePrecheckProcess,
} from './process-tree';

describe('terminatePrecheckProcess', () => {
  const makeFakeChild = (pid?: number) => {
    const listeners: Record<string, (() => void)[]> = {};
    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      once: (event: string, fn: () => void) => void;
      pid?: number;
    };
    child.kill = vi.fn();
    child.pid = pid;
    (child as any).once = (event: string, fn: () => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
      return child;
    };
    (child as any).__emit = (event: string) => {
      for (const fn of listeners[event] || []) fn();
    };
    (child as any).__listeners = listeners;
    return child;
  };

  it('sends SIGTERM via signalProcessTree and settles on the exit event', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild(4242);
      const onSettled = vi.fn();
      const groupKill = vi.spyOn(process, 'kill').mockImplementation(((
        pid: number,
        sig?: NodeJS.Signals,
      ) => {
        if (pid === -4242) return true;
        return process.kill(pid, sig);
      }) as any);

      terminatePrecheckProcess(child as any, onSettled);
      // signalProcessTree awaits a 100ms delay before the direct-kill belt
      await vi.advanceTimersByTimeAsync(150);

      // -pid signals the whole POSIX process group (launcher + workers)
      expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(onSettled).not.toHaveBeenCalled();

      (child as any).__emit('exit');
      expect(onSettled).toHaveBeenCalledTimes(1);
      // The SIGKILL escalation survives the launcher's exit (P2 4306440127);
      // only the hard fallback is cleared by settle. advanceTimersByTimeAsync
      // flushes the promise chain inside signalProcessTree so the direct-kill
      // belt (100ms after the group signal) lands before the assertion.
      await vi.advanceTimersByTimeAsync(2000);
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGKILL');
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the group SIGKILL escalation when the launcher exits early and a worker ignores SIGTERM (P2 4306440127)', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild(4242);
      const onSettled = vi.fn();
      const groupKill = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      terminatePrecheckProcess(child as any, onSettled);
      await vi.advanceTimersByTimeAsync(150);
      // The launcher dies on the group SIGTERM before the grace period ends;
      // a worker descendant ignored the signal and is still alive.
      (child as any).__emit('exit');
      expect(onSettled).toHaveBeenCalledTimes(1);

      // The escalation must still fire after the grace period — settle no
      // longer cancels it, otherwise the ignoring worker leaks.
      await vi.advanceTimersByTimeAsync(600); // grace 500 + retry 100
      expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGKILL');
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
      expect(onSettled).toHaveBeenCalledTimes(1); // settled exactly once
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates to a SIGKILL group signal after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild(4242);
      const onSettled = vi.fn();
      const groupKill = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      terminatePrecheckProcess(child as any, onSettled);
      await vi.advanceTimersByTimeAsync(600); // grace 500 + retry 100

      expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGKILL');
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');

      // exit after escalation settles and clears the fallback timer
      (child as any).__emit('exit');
      expect(onSettled).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2000);
      expect(onSettled).toHaveBeenCalledTimes(1);
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to a direct child kill when the process group is gone (ESRCH)', async () => {
    const child = makeFakeChild(9999);
    const onSettled = vi.fn();
    // No group exists for -9999: process.kill(-pid) throws ESRCH
    const groupKill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (typeof pid === 'number' && pid < 0) {
        const e = new Error('no such process') as NodeJS.ErrnoException;
        e.code = 'ESRCH';
        throw e;
      }
      return true;
    }) as any);

    await signalProcessTree(child as any, 'SIGTERM');

    // group signal failed, but the direct child still got the signal
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(onSettled).not.toHaveBeenCalled();
    groupKill.mockRestore();
  });

  it('uses the direct kill path for children without a pid (mocked children)', async () => {
    const child = makeFakeChild(undefined);

    await signalProcessTree(child as any, 'SIGTERM');

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('settles via the hard fallback even when no exit event ever fires', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild(4242);
      const onSettled = vi.fn();
      const groupKill = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      terminatePrecheckProcess(child as any, onSettled);
      await vi.advanceTimersByTimeAsync(1600); // SIGTERM round + SIGKILL round

      expect(onSettled).toHaveBeenCalledTimes(1);
      // SIGTERM (group+direct) + SIGKILL (group+direct)
      expect(child.kill).toHaveBeenCalledTimes(2);
      expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGTERM');
      expect(groupKill).toHaveBeenCalledWith(-4242, 'SIGKILL');
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles only once across exit and fallback races', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild(4242);
      const onSettled = vi.fn();
      const groupKill = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      terminatePrecheckProcess(child as any, onSettled);
      await vi.advanceTimersByTimeAsync(150);
      (child as any).__emit('exit');
      vi.advanceTimersByTime(2000);

      expect(onSettled).toHaveBeenCalledTimes(1);
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reapOrphanedProcessGroup', () => {
  it('sends the initial group signal immediately and re-checks once', async () => {
    vi.useFakeTimers();
    try {
      const groupKill = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      reapOrphanedProcessGroup(5555);

      expect(groupKill).toHaveBeenCalledWith(-5555, 'SIGKILL');

      await vi.advanceTimersByTimeAsync(500);
      expect(groupKill).toHaveBeenCalledTimes(2);
      expect(groupKill).toHaveBeenLastCalledWith(-5555, 'SIGKILL');
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule a re-check when the group is already gone', async () => {
    vi.useFakeTimers();
    try {
      const groupKill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
        if (typeof pid === 'number' && pid < 0) {
          const e = new Error('no such process') as NodeJS.ErrnoException;
          e.code = 'ESRCH';
          throw e;
        }
        return true;
      }) as any);

      reapOrphanedProcessGroup(5555);

      await vi.advanceTimersByTimeAsync(1000);
      expect(groupKill).toHaveBeenCalledTimes(1); // initial probe only
      groupKill.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs and leaves alone a group it cannot signal (EPERM / setsid daemon)', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const groupKill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
        if (typeof pid === 'number' && pid < 0) {
          const e = new Error('operation not permitted') as NodeJS.ErrnoException;
          e.code = 'EPERM';
          throw e;
        }
        return true;
      }) as any);

      reapOrphanedProcessGroup(6666);

      await vi.advanceTimersByTimeAsync(1000);
      expect(groupKill).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('EPERM'));
      groupKill.mockRestore();
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('windows launcher pre-exit recovery (P2 4307489808)', () => {
  // The Windows branches key off process.platform at call time; pin it to
  // win32 (and restore) so the paths are covered on a POSIX dev machine.
  const pinWindowsPlatform = () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    return () => Object.defineProperty(process, 'platform', descriptor);
  };

  // ./process-tree is statically imported at the top of this file; clear the
  // module registry so vi.doMock applies to the dynamic re-import below.
  const setupWindowsMocks = (plan: { taskkill: 'ok' | 'fail'; cim?: string }) => {
    vi.resetModules();
    const taskkillInvocations: string[][] = [];
    let cimSnapshotCount = 0;
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<any>();
      return {
        ...actual,
        execFile: (
          file: string,
          args: readonly string[],
          optionsOrCallback: { timeout?: number } | ((error: Error | null, stdout: string) => void),
          maybeCallback?: (error: Error | null, stdout: string) => void,
        ) => {
          // Node arity: (file, args, callback) or (file, args, options, callback)
          const callback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
          if (typeof callback !== 'function') {
            throw new TypeError('mock execFile: no callback provided');
          }
          if (file === 'taskkill') {
            if (plan.taskkill === 'ok') callback(null, '');
            else callback(new Error('The process not found.'), '');
            return;
          }
          if (file === 'powershell' && typeof plan.cim === 'string') {
            cimSnapshotCount += 1;
            callback(null, plan.cim);
            return;
          }
          callback(new Error(`unexpected invocation: ${file}`), '');
        },
      } as any;
    });
    vi.doMock('node:util', async (importOriginal) => {
      const actual = await importOriginal<any>();
      return {
        ...actual,
        promisify:
          (fn: (...args: any[]) => void) =>
          (...args: any[]) =>
            new Promise((resolve, reject) => {
              (fn as any)(...args, (error: Error | null, stdout: string) => {
                if (error) reject(error);
                else resolve({ stdout });
              });
              if (args[0] === 'taskkill') {
                taskkillInvocations.push([...(args[1] as readonly string[])]);
              }
            }),
      } as any;
    });
    return {
      taskkillInvocations,
      cimSnapshotCount: () => cimSnapshotCount,
    };
  };

  const restoreMocks = () => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:util');
    vi.resetModules();
  };

  it('directly force-kills surviving descendants when the root taskkill fails (terminate path)', async () => {
    const restorePlatform = pinWindowsPlatform();
    const { taskkillInvocations } = setupWindowsMocks({
      taskkill: 'fail',
      cim: JSON.stringify([
        { ProcessId: 111, ParentProcessId: 4242 },
        { ProcessId: 222, ParentProcessId: 111 },
        { ProcessId: 333, ParentProcessId: 999 },
      ]),
    });

    try {
      const { signalProcessTree } = await import('./process-tree');
      const child = new EventEmitter() as EventEmitter & { kill: any; pid?: number };
      child.kill = vi.fn();
      child.pid = 4242;

      // EPERM → treat as alive; ESRCH → already gone
      const aliveProbe = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
        if (pid === 111 || pid === 222) {
          const e = new Error('operation not permitted') as NodeJS.ErrnoException;
          e.code = 'EPERM';
          throw e;
        }
        const e = new Error('no such process') as NodeJS.ErrnoException;
        e.code = 'ESRCH';
        throw e;
      }) as any);

      await signalProcessTree(child as any, 'SIGTERM');

      // Root /T /F failed → one batched direct kill for the survivors
      // (111 + 222; 333 is not a descendant of 4242)
      expect(taskkillInvocations.length).toBe(2);
      expect(taskkillInvocations[0]).toEqual(['/pid', '4242', '/T', '/F']);
      expect(taskkillInvocations[1]).toEqual(['/pid', '111', '/pid', '222', '/F']);
      aliveProbe.mockRestore();
    } finally {
      restorePlatform();
      restoreMocks();
    }
  });

  it('sweeps surviving descendants detached after the root kill in the reaper (zero-code path)', async () => {
    const restorePlatform = pinWindowsPlatform();
    const { taskkillInvocations } = setupWindowsMocks({
      taskkill: 'fail',
      cim: JSON.stringify([
        { ProcessId: 777, ParentProcessId: 5555 },
        { ProcessId: 888, ParentProcessId: 777 },
      ]),
    });

    try {
      const { reapOrphanedProcessGroup } = await import('./process-tree');
      const aliveProbe = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
        if (pid === 777) return true; // survivor
        const e = new Error('no such process') as NodeJS.ErrnoException;
        e.code = 'ESRCH';
        throw e;
      }) as any);

      reapOrphanedProcessGroup(5555);

      // The sweep is detached (not awaited) — poll until the survivor batch lands.
      await vi.waitFor(() => {
        expect(taskkillInvocations.length).toBe(2);
      });
      expect(taskkillInvocations[0]).toEqual(['/pid', '5555', '/T', '/F']);
      // 888 is a descendant but probes dead (ESRCH) → only 777 is swept.
      expect(taskkillInvocations[1]).toEqual(['/pid', '777', '/F']);
      aliveProbe.mockRestore();
    } finally {
      restorePlatform();
      restoreMocks();
    }
  });

  it('skips the survivor sweep when the root taskkill succeeds (terminate path)', async () => {
    const restorePlatform = pinWindowsPlatform();
    const { taskkillInvocations, cimSnapshotCount } = setupWindowsMocks({
      taskkill: 'ok',
      cim: '[]',
    });

    try {
      const { signalProcessTree } = await import('./process-tree');
      const child = new EventEmitter() as EventEmitter & { kill: any; pid?: number };
      child.kill = vi.fn();
      child.pid = 4242;

      await signalProcessTree(child as any, 'SIGTERM');

      // Root kill landed; no CIM snapshot round and no extra taskkill call.
      expect(taskkillInvocations).toEqual([['/pid', '4242', '/T', '/F']]);
      expect(cimSnapshotCount()).toBe(0);
    } finally {
      restorePlatform();
      restoreMocks();
    }
  });
});
