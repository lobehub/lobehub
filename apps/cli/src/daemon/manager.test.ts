import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// eslint-disable-next-line import-x/first
import {
  appendLog,
  getLogPath,
  getRunningDaemonPid,
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

describe('daemon manager', () => {
  beforeEach(async () => {
    await mkdir(mockDir, { recursive: true });
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
  });
});
