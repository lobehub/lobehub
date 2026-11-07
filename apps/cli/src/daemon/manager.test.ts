import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { xSync } from 'tinyexec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendLog,
  getLogPath,
  getRunningDaemonPid,
  isDaemonProcess,
  isProcessAlive,
  readPid,
  readStatus,
  removePid,
  removeStatus,
  rotateLogIfNeeded,
  stopDaemon,
  stopDaemonAndWait,
  writePid,
  writeStatus,
} from './manager';

const tmpDir = path.join(os.tmpdir(), 'daemon-test-' + process.pid);
const mockDir = path.join(tmpDir, '.lobehub');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual['default'],
      homedir: () => tmpDir,
    },
  };
});

// Mock only `xSync` (used by isDaemonProcess to read a process command line);
// keep the real async executor so daemon integration tests still spawn children.
vi.mock('tinyexec', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, xSync: vi.fn() };
});

// A command line that matches the daemon signature (`connect … --daemon-child`).
const DAEMON_COMMAND = '/usr/local/bin/node /path/to/cli.js connect --daemon-child';

describe('daemon manager', () => {
  beforeEach(async () => {
    await mkdir(mockDir, { recursive: true });
    // Default: any inspected PID looks like our daemon. Tests that need a
    // reused / unrelated PID override this per-case.
    vi.mocked(xSync).mockReturnValue({ stdout: DAEMON_COMMAND } as any);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  describe('PID file', () => {
    it('should write and read PID', () => {
      writePid(12345);
      expect(readPid()).toBe(12345);
    });

    it('should return null when no PID file', () => {
      expect(readPid()).toBeNull();
    });

    it('should return null for invalid PID content', async () => {
      await writeFile(path.join(mockDir, 'daemon.pid'), 'not-a-number');
      expect(readPid()).toBeNull();
    });

    it('should remove PID file', () => {
      writePid(12345);
      removePid(12345);
      expect(readPid()).toBeNull();
    });

    it('should not throw when removing non-existent PID file', () => {
      expect(() => removePid(12345)).not.toThrow();
    });
  });

  describe('isProcessAlive', () => {
    it('should return true for current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('should return false for non-existent PID', () => {
      expect(isProcessAlive(999999)).toBe(false);
    });
  });

  describe('isDaemonProcess', () => {
    it('should return true when the command line matches the daemon signature', () => {
      vi.mocked(xSync).mockReturnValue({ stdout: DAEMON_COMMAND } as any);
      expect(isDaemonProcess(12345)).toBe(true);
      expect(xSync).toHaveBeenCalledWith(
        'ps',
        ['-ww', '-p', '12345', '-o', 'command='],
        expect.any(Object),
      );
    });

    it('should return false for an unrelated process command line', () => {
      vi.mocked(xSync).mockReturnValue({ stdout: '/usr/bin/vim notes.txt' } as any);
      expect(isDaemonProcess(12345)).toBe(false);
    });

    it('should return false when the signature is only partially present', () => {
      // `connect` without the internal `--daemon-child` flag is not our daemon.
      vi.mocked(xSync).mockReturnValue({ stdout: '/usr/bin/node /path/cli connect' } as any);
      expect(isDaemonProcess(12345)).toBe(false);
    });

    it('should return false when ps is unavailable / throws', () => {
      vi.mocked(xSync).mockImplementation(() => {
        throw new Error('ps: command not found');
      });
      expect(isDaemonProcess(12345)).toBe(false);
    });
  });

  describe('getRunningDaemonPid', () => {
    it('should return null when no PID file', () => {
      expect(getRunningDaemonPid()).toBeNull();
    });

    it('should return PID when process is alive', () => {
      writePid(process.pid);
      expect(getRunningDaemonPid()).toBe(process.pid);
    });

    it('should clean up stale PID file and return null', () => {
      writePid(999999);
      expect(getRunningDaemonPid()).toBeNull();
      // PID file should be removed
      expect(readPid()).toBeNull();
    });

    it('should also remove status file for stale PID', () => {
      writePid(999999);
      writeStatus({
        connectionStatus: 'connected',
        gatewayUrl: 'https://test.com',
        pid: 999999,
        startedAt: new Date().toISOString(),
      });

      getRunningDaemonPid();

      expect(readStatus()).toBeNull();
    });

    it('preserves a service status when cleaning up an unrelated stale daemon pid', () => {
      writePid(999999);
      const serviceStatus = {
        cliVersion: '0.0.71',
        connectionStatus: 'connected',
        gatewayUrl: 'https://test.com',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      };
      writeStatus(serviceStatus);
      vi.mocked(xSync).mockReturnValue({
        stdout: '/usr/bin/node cli.js connect --service-child',
      } as any);

      expect(getRunningDaemonPid()).toBeNull();
      expect(readPid()).toBeNull();
      expect(readStatus()).toEqual(serviceStatus);
    });

    it('should treat a live but reused (non-daemon) PID as stale and clean up', () => {
      // process.pid is alive, but the inspected command line is not our daemon —
      // simulates the OS reusing a dead daemon's PID for an unrelated process.
      writePid(process.pid);
      writeStatus({
        connectionStatus: 'connected',
        gatewayUrl: 'https://test.com',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
      vi.mocked(xSync).mockReturnValue({ stdout: '/usr/bin/some-other-process' } as any);

      expect(getRunningDaemonPid()).toBeNull();
      expect(readPid()).toBeNull();
      expect(readStatus()).toBeNull();
    });
  });

  describe('status file', () => {
    it('should write and read status', () => {
      const status = {
        connectionStatus: 'connected',
        gatewayUrl: 'https://gateway.test.com',
        pid: 12345,
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      writeStatus(status);
      expect(readStatus()).toEqual(status);
    });

    it('should return null when no status file', () => {
      expect(readStatus()).toBeNull();
    });

    it('should remove status file', () => {
      writeStatus({
        connectionStatus: 'connected',
        gatewayUrl: 'https://test.com',
        pid: 1,
        startedAt: '',
      });
      removeStatus(1);
      expect(readStatus()).toBeNull();
    });

    it('should not throw when removing non-existent status file', () => {
      expect(() => removeStatus(1)).not.toThrow();
    });
  });

  describe('restart ownership and recovery', () => {
    const statusFor = (pid: number) => ({
      connectionStatus: 'connected',
      gatewayUrl: 'https://gateway.test',
      pid,
      startedAt: '',
    });

    it('does not let late cleanup from a predecessor delete a replacement', () => {
      writePid(101);
      writeStatus(statusFor(101));
      writePid(202);
      writeStatus(statusFor(202));

      removePid(101);
      removeStatus(101);

      expect(readPid()).toBe(202);
      expect(readStatus()?.pid).toBe(202);
      removePid(202);
      removeStatus(202);
      expect(readPid()).toBeNull();
      expect(readStatus()).toBeNull();
    });

    it('recovers a live daemon from its status without restarting it', () => {
      writeStatus(statusFor(process.pid));
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        expect(getRunningDaemonPid()).toBe(process.pid);
        expect(readPid()).toBe(process.pid);
        expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
      } finally {
        kill.mockRestore();
      }
    });

    it('recovers the replacement after cleaning up a different stale pid', () => {
      writePid(999999);
      writeStatus(statusFor(process.pid));
      expect(getRunningDaemonPid()).toBe(process.pid);
      expect(readPid()).toBe(process.pid);
      expect(readStatus()?.pid).toBe(process.pid);
    });

    it.each([
      '/usr/bin/node cli.js connect --service-child',
      '/usr/bin/node cli.js connect',
      '/usr/bin/vim notes.txt',
      '/usr/bin/node cli.js disconnect --daemon-child',
      '/usr/bin/node cli.js connect --daemon-child-extra',
    ])('does not recover a service, foreground, or unrelated process: %s', (command) => {
      writeStatus(statusFor(process.pid));
      vi.mocked(xSync).mockReturnValue({ stdout: command } as any);
      expect(getRunningDaemonPid()).toBeNull();
      expect(readPid()).toBeNull();
      expect(readStatus()?.pid).toBe(process.pid);
    });

    it('does not overwrite a concurrent launcher while recovering a missing pid', () => {
      writeStatus(statusFor(42));
      const originalWrite = fs.writeFileSync;
      const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((file, data, options) => {
        originalWrite(file, '84', { mode: 0o600 });
        originalWrite(file, data, options);
      });
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        expect(getRunningDaemonPid()).toBe(84);
        expect(readPid()).toBe(84);
      } finally {
        write.mockRestore();
        kill.mockRestore();
      }
    });

    it.each([0, -1, 1.5, '42', null])('does not trust an invalid status pid: %s', async (pid) => {
      await writeFile(
        path.join(mockDir, 'daemon.status.json'),
        JSON.stringify({ ...statusFor(42), pid }),
      );
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        expect(getRunningDaemonPid()).toBeNull();
        expect(kill).not.toHaveBeenCalled();
      } finally {
        kill.mockRestore();
      }
    });

    it('does not recover a dead daemon or signal it', () => {
      writeStatus(statusFor(999999));
      expect(getRunningDaemonPid()).toBeNull();
      expect(readPid()).toBeNull();
    });

    it('does not recover when process identity cannot be read', () => {
      writeStatus(statusFor(process.pid));
      vi.mocked(xSync).mockImplementation(() => {
        throw new Error('ps unavailable');
      });
      expect(getRunningDaemonPid()).toBeNull();
      expect(readPid()).toBeNull();
    });

    it.skipIf(process.platform === 'win32')(
      'refuses a restart from a daemon-owned shell before signaling',
      async () => {
        writePid(process.ppid);
        writeStatus(statusFor(process.ppid));
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        try {
          await expect(stopDaemonAndWait(0)).rejects.toThrow('terminal or shell');
          expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
          expect(readPid()).toBe(process.ppid);
          expect(readStatus()?.pid).toBe(process.ppid);
        } finally {
          kill.mockRestore();
        }
      },
    );

    it('retains metadata and refuses replacement if shutdown times out', async () => {
      writePid(999999);
      writeStatus(statusFor(999999));
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        await expect(stopDaemonAndWait(0)).rejects.toThrow('No replacement was started');
        expect(readPid()).toBe(999999);
        expect(readStatus()?.pid).toBe(999999);
      } finally {
        kill.mockRestore();
      }
    });

    it('does not mistake an argv inspection failure for a completed shutdown', async () => {
      writePid(999999);
      writeStatus(statusFor(999999));
      vi.mocked(xSync).mockReturnValueOnce({ stdout: DAEMON_COMMAND } as any);
      vi.mocked(xSync).mockReturnValueOnce({ stdout: DAEMON_COMMAND } as any);
      vi.mocked(xSync).mockImplementation(() => {
        throw new Error('ps unavailable');
      });
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        await expect(stopDaemonAndWait(0)).rejects.toThrow('No replacement was started');
        expect(readPid()).toBe(999999);
      } finally {
        kill.mockRestore();
      }
    });

    it('does not signal a PID whose identity changed during ancestry inspection', async () => {
      writePid(999999);
      writeStatus(statusFor(999999));
      vi.mocked(xSync)
        .mockReturnValueOnce({ stdout: DAEMON_COMMAND } as any)
        .mockReturnValueOnce({ stdout: '/usr/bin/unrelated-process' } as any);
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      try {
        await expect(stopDaemonAndWait()).rejects.toThrow('Daemon identity changed');
        expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
        expect(readPid()).toBe(999999);
      } finally {
        kill.mockRestore();
      }
    });

    it('retains metadata if signaling the daemon is denied', async () => {
      writePid(999999);
      writeStatus(statusFor(999999));
      const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 'SIGTERM') throw Object.assign(new Error('denied'), { code: 'EPERM' });
        return true;
      });
      try {
        await expect(stopDaemonAndWait()).rejects.toThrow('denied');
        expect(readPid()).toBe(999999);
        expect(readStatus()?.pid).toBe(999999);
      } finally {
        kill.mockRestore();
      }
    });

    it.each(['0', '-1', '123garbage', '1.5'])(
      'rejects unsafe pid file contents: %s',
      async (value) => {
        await writeFile(path.join(mockDir, 'daemon.pid'), value);
        expect(readPid()).toBeNull();
      },
    );

    it('does not delete a replacement that appears while stop is signaling its predecessor', () => {
      writePid(process.pid);
      writeStatus(statusFor(process.pid));
      const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 'SIGTERM') {
          writePid(202);
          writeStatus(statusFor(202));
        }
        return true;
      });
      try {
        expect(stopDaemon()).toBe(true);
        expect(readPid()).toBe(202);
        expect(readStatus()?.pid).toBe(202);
      } finally {
        kill.mockRestore();
      }
    });
  });

  describe('log file', () => {
    it('should return correct log path', () => {
      expect(getLogPath()).toBe(path.join(mockDir, 'daemon.log'));
    });

    it('should append log lines', () => {
      appendLog('test message');
      appendLog('second line');

      const content = fs.readFileSync(getLogPath(), 'utf8');
      expect(content).toContain('test message');
      expect(content).toContain('second line');
      // Should have ISO timestamps
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should rotate log when exceeding max size', async () => {
      const logPath = getLogPath();
      // Write a file larger than 5MB
      const bigContent = 'x'.repeat(6 * 1024 * 1024);
      await writeFile(logPath, bigContent);

      rotateLogIfNeeded();

      // Original should be gone or rotated
      expect(fs.existsSync(logPath + '.1')).toBe(true);
      // New writes should go to a fresh file
      expect(fs.existsSync(logPath)).toBe(false);
    });

    it('should not rotate when log is small', async () => {
      const logPath = getLogPath();
      await writeFile(logPath, 'small content');

      rotateLogIfNeeded();

      expect(fs.existsSync(logPath + '.1')).toBe(false);
      expect(fs.readFileSync(logPath, 'utf8')).toBe('small content');
    });

    it('should handle rotation when no log file exists', () => {
      expect(() => rotateLogIfNeeded()).not.toThrow();
    });
  });

  describe('stopDaemon', () => {
    it('should return false when no daemon is running', () => {
      expect(stopDaemon()).toBe(false);
    });

    it('should return true and clean up when daemon is running', () => {
      // Use current PID as a "running" daemon
      writePid(process.pid);
      writeStatus({
        connectionStatus: 'connected',
        gatewayUrl: 'https://test.com',
        pid: process.pid,
        startedAt: '',
      });

      // Mock process.kill to avoid actually sending SIGTERM to ourselves
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const result = stopDaemon();

      expect(result).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(readPid()).toBeNull();
      expect(readStatus()).toBeNull();

      killSpy.mockRestore();
    });

    it('should handle kill error gracefully', () => {
      writePid(process.pid);

      let callCount = 0;
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
        callCount++;
        if (callCount === 1) return true; // isProcessAlive check (signal 0)
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      }) as any);

      const result = stopDaemon();
      expect(result).toBe(true);

      killSpy.mockRestore();
    });

    it('should NOT SIGTERM a live PID that is not our daemon', () => {
      // Stale daemon.pid whose PID was reused by an unrelated, living process.
      writePid(process.pid);
      vi.mocked(xSync).mockReturnValue({ stdout: '/usr/bin/some-other-process' } as any);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const result = stopDaemon();

      expect(result).toBe(false);
      // Only the liveness probe (signal 0) is allowed — never a real SIGTERM.
      expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGTERM');
      // Stale metadata is cleaned up so we don't keep re-checking it.
      expect(readPid()).toBeNull();

      killSpy.mockRestore();
    });
  });
});
