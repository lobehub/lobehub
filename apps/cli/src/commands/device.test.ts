import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatUtils from '../utils/format';
import { log } from '../utils/logger';
import { registerDeviceCommand } from './device';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    device: {
      getDeviceSystemInfo: { query: vi.fn() },
      listDevices: { query: vi.fn() },
      removeDevice: { mutate: vi.fn() },
      removeWorkspaceDevice: { mutate: vi.fn() },
      status: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockConfirm } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), heartbeat: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));
vi.mock('../utils/format', async (importOriginal) => {
  const actual = await importOriginal<typeof FormatUtils>();
  return { ...actual, confirm: mockConfirm };
});

describe('device command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockConfirm.mockReset();
    for (const method of Object.values(mockTrpcClient.device)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    // Default: the deletable ids exist as PERSONAL devices, so `delete` resolves
    // them to the personal `removeDevice` path. Tests override per-scope as needed.
    mockTrpcClient.device.listDevices.query.mockResolvedValue([
      { deviceId: 'd1', scope: 'personal' },
      { deviceId: 'd2', scope: 'personal' },
      { deviceId: '8040798a77ae', scope: 'personal' },
    ]);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerDeviceCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list under the personal context without --workspace', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'list', '--json']);

      expect(mockGetTrpcClient).toHaveBeenCalledWith(undefined);
      const printed = JSON.parse(consoleSpy.mock.calls.at(-1)![0]);
      expect(printed.map((d: any) => d.deviceId)).toEqual(['d1', 'd2', '8040798a77ae']);
    });

    it('should filter to workspace-scope devices when --workspace is set', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'p1', scope: 'personal' },
        { deviceId: 'ws1', scope: 'workspace' },
        { deviceId: 'ws2', scope: 'workspace' },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'device',
        'list',
        '--json',
        '--workspace',
        'ws-abc',
      ]);

      expect(mockGetTrpcClient).toHaveBeenCalledWith('ws-abc');
      const printed = JSON.parse(consoleSpy.mock.calls.at(-1)![0]);
      expect(printed.map((d: any) => d.deviceId)).toEqual(['ws1', 'ws2']);
    });

    it('should keep the personal+workspace union when the context is ambient (no flag)', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'p1', scope: 'personal' },
        { deviceId: 'ws1', scope: 'workspace' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'list', '--json']);

      const printed = JSON.parse(consoleSpy.mock.calls.at(-1)![0]);
      expect(printed.map((d: any) => d.deviceId)).toEqual(['p1', 'ws1']);
    });
  });

  describe('delete', () => {
    it('should remove a device with --yes (no prompt)', async () => {
      mockTrpcClient.device.removeDevice.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'd1', '--yes']);

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.device.removeDevice.mutate).toHaveBeenCalledWith({ deviceId: 'd1' });
    });

    it('should remove multiple devices in one call', async () => {
      mockTrpcClient.device.removeDevice.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'd1', 'd2', '--yes']);

      expect(mockTrpcClient.device.removeDevice.mutate).toHaveBeenNthCalledWith(1, {
        deviceId: 'd1',
      });
      expect(mockTrpcClient.device.removeDevice.mutate).toHaveBeenNthCalledWith(2, {
        deviceId: 'd2',
      });
    });

    it('should be reachable via the `remove` alias', async () => {
      mockTrpcClient.device.removeDevice.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'remove', 'd1', '--yes']);

      expect(mockTrpcClient.device.removeDevice.mutate).toHaveBeenCalledWith({ deviceId: 'd1' });
    });

    it('should prompt for confirmation and remove when confirmed', async () => {
      mockConfirm.mockResolvedValue(true);
      mockTrpcClient.device.removeDevice.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'd1']);

      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.device.removeDevice.mutate).toHaveBeenCalledWith({ deviceId: 'd1' });
    });

    it('should cancel without removing when not confirmed', async () => {
      mockConfirm.mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'd1']);

      expect(mockTrpcClient.device.removeDevice.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cancelled.');
    });

    it('should exit(1) when a removal fails', async () => {
      mockTrpcClient.device.removeDevice.mutate.mockRejectedValue(new Error('boom'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'd1', '--yes']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should route a workspace device to removeWorkspaceDevice', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'ws1', scope: 'workspace' },
      ]);
      mockTrpcClient.device.removeWorkspaceDevice.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'ws1', '--yes']);

      expect(mockTrpcClient.device.removeWorkspaceDevice.mutate).toHaveBeenCalledWith({
        deviceId: 'ws1',
      });
      expect(mockTrpcClient.device.removeDevice.mutate).not.toHaveBeenCalled();
    });

    it('should resolve the client under the workspace context when --workspace is set', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'ws1', scope: 'workspace' },
      ]);
      mockTrpcClient.device.removeWorkspaceDevice.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'device',
        'delete',
        'ws1',
        '--yes',
        '--workspace',
        'ws-abc',
      ]);

      expect(mockGetTrpcClient).toHaveBeenCalledWith('ws-abc');
      expect(mockTrpcClient.device.removeWorkspaceDevice.mutate).toHaveBeenCalledWith({
        deviceId: 'ws1',
      });
    });

    it('should error + exit(1) without deleting when the device is not in the list', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'other', scope: 'personal' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'device', 'delete', 'missing', '--yes']);

      expect(mockTrpcClient.device.removeDevice.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.device.removeWorkspaceDevice.mutate).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('was not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
