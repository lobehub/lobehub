import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

// Mock only `execFileSync` (used by isDaemonProcess to read a process command
// line); keep the real `spawn` so nothing else changes.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, execFileSync: vi.fn() };
});

// A command line that matches the daemon signature (`connect … --daemon-child`).
const DAEMON_COMMAND = '/usr/local/bin/node /path/to/cli.js connect --daemon-child';

describe('daemon manager', () => {
  beforeEach(async () => {
    await mkdir(mockDir, { recursive: true });
    // Default: any inspected PID looks like our daemon. Tests that need a
    // reused / unrelated PID override this per-case.
    vi.mocked(execFileSync).mockReturnValue(DAEMON_COMMAND as any);
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
      removePid();
      expect(readPid()).toBeNull();
    });

    it('should not throw when removing non-existent PID file', () => {
      expect(() => removePid()).not.toThrow();
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
      vi.mocked(execFileSync).mockReturnValue(DAEMON_COMMAND as any);
      expect(isDaemonProcess(12345)).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        'ps',
        ['-ww', '-p', '12345', '-o', 'command='],
        expect.any(Object),
      );
    });

    it('should return false for an unrelated process command line', () => {
      vi.mocked(execFileSync).mockReturnValue('/usr/bin/vim notes.txt' as any);
      expect(isDaemonProcess(12345)).toBe(false);
    });

    it('should return false when the signature is only partially present', () => {
      // `connect` without the internal `--daemon-child` flag is not our daemon.
      vi.mocked(execFileSync).mockReturnValue('/usr/bin/node /path/cli connect' as any);
      expect(isDaemonProcess(12345)).toBe(false);
    });

    it('should return false when ps is unavailable / throws', () => {
      vi.mocked(execFileSync).mockImplementation(() => {
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
      vi.mocked(execFileSync).mockReturnValue('/usr/bin/some-other-process' as any);

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
      removeStatus();
      expect(readStatus()).toBeNull();
    });

    it('should not throw when removing non-existent status file', () => {
      expect(() => removeStatus()).not.toThrow();
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
        throw new Error('no such process'); // actual SIGTERM
      }) as any);

      const result = stopDaemon();
      expect(result).toBe(true);

      killSpy.mockRestore();
    });

    it('should NOT SIGTERM a live PID that is not our daemon', () => {
      // Stale daemon.pid whose PID was reused by an unrelated, living process.
      writePid(process.pid);
      vi.mocked(execFileSync).mockReturnValue('/usr/bin/some-other-process' as any);

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
