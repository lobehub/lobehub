import { AuvApiName, AuvIdentifier } from '@lobechat/builtin-tool-auv';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

type SystemInfoRead =
  { ok: true; systemInfo: Record<string, unknown> } | { ok: false; reason: string };

const executeToolCallMock = vi.fn();
const readDeviceSystemInfoMock = vi.fn<(...args: unknown[]) => Promise<SystemInfoRead>>();
const resolveDeviceClientKindMock = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    // Mirrors the service: the lossy read is the detailed one minus the reason.
    queryDeviceSystemInfo: async (...args: unknown[]) => {
      const read = await readDeviceSystemInfoMock(...args);
      return read.ok ? read.systemInfo : undefined;
    },
    readDeviceSystemInfo: (...args: unknown[]) => readDeviceSystemInfoMock(...args),
  },
}));
vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    executeToolCallMock(...args),
}));
vi.mock('@/server/services/deviceGateway/deviceChannels', () => ({
  resolveDeviceClientKind: (...args: unknown[]) => resolveDeviceClientKindMock(...args),
}));

const { auvRuntime } = await import('../auv');

const baseContext: ToolExecutionContext = {
  activeDeviceId: 'device-1',
  toolManifestMap: {},
  userId: 'user-1',
};

describe('auvRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readDeviceSystemInfoMock.mockResolvedValue({
      ok: true,
      systemInfo: { supportedTools: [AuvIdentifier] },
    });
    resolveDeviceClientKindMock.mockResolvedValue('desktop');
    executeToolCallMock.mockResolvedValue({ content: 'ok', success: true });
  });

  it('requires a user and active device', () => {
    expect(() => auvRuntime.factory({ activeDeviceId: 'device-1', toolManifestMap: {} })).toThrow(
      'userId is required for AUV device proxy execution',
    );
    expect(() => auvRuntime.factory({ toolManifestMap: {}, userId: 'user-1' })).toThrow(
      'activeDeviceId is required for AUV device proxy execution',
    );
  });

  it('rejects old clients before forwarding a tool call', async () => {
    readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: true, systemInfo: { arch: 'arm64' } });
    const runtime = auvRuntime.factory(baseContext);
    await expect(runtime.runCommand({ argv: ['invoke', 'display.list'] })).rejects.toThrow(
      'does not support Computer Use',
    );
    expect(executeToolCallMock).not.toHaveBeenCalled();
  });

  it('proxies runCommand to the active desktop device', async () => {
    const context: ToolExecutionContext = {
      ...baseContext,
      operationId: 'operation-1',
      workspaceId: 'workspace-1',
    };
    const args = { argv: ['invoke', 'display.capture'] };
    const expected = { content: 'ok', success: true };
    executeToolCallMock.mockResolvedValue(expected);

    const runtime = auvRuntime.factory(context);
    const result = await runtime.runCommand(args);

    expect(auvRuntime.identifier).toBe(AuvIdentifier);
    expect(executeToolCallMock).toHaveBeenCalledWith(
      {
        deviceId: 'device-1',
        operationId: 'operation-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        apiName: AuvApiName.runCommand,
        arguments: JSON.stringify(args),
        identifier: AuvIdentifier,
      },
      undefined,
    );
    expect(result).toEqual(expected);
    expect(resolveDeviceClientKindMock).not.toHaveBeenCalled();
  });

  it('reads the capability from the desktop client, not a cli on the same device', async () => {
    const runtime = auvRuntime.factory(baseContext);
    await runtime.runCommand({ argv: ['invoke', 'display.list'] });

    expect(readDeviceSystemInfoMock).toHaveBeenCalledWith('user-1', 'device-1', undefined, {
      clientKinds: ['desktop'],
    });
  });

  describe('when the device does not answer the capability check', () => {
    it('dispatches to a device with a live desktop app instead of reporting it unsupported', async () => {
      // Production: a busy desktop missed the 10s system-info deadline and the
      // call failed as "does not support Computer Use" without being sent.
      readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: false, reason: 'TIMEOUT' });

      const runtime = auvRuntime.factory(baseContext);
      const result = await runtime.runCommand({ argv: ['invoke', 'display.list'] });

      expect(resolveDeviceClientKindMock).toHaveBeenCalledWith('user-1', 'device-1', undefined);
      expect(executeToolCallMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ content: 'ok', success: true });
    });

    it('does not dispatch to a CLI-only device and names the CLI', async () => {
      readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: false, reason: 'TIMEOUT' });
      resolveDeviceClientKindMock.mockResolvedValueOnce('cli-only');

      const runtime = auvRuntime.factory(baseContext);
      const result = await runtime.runCommand({ argv: ['invoke', 'display.list'] });

      expect(executeToolCallMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        error: { code: 'COMPUTER_USE_DEVICE_UNAVAILABLE' },
        success: false,
      });
      expect(result.content).toContain('`lh connect` CLI');
    });

    it('does not dispatch when the device also runs the CLI, which the gateway prefers', async () => {
      readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: false, reason: 'TIMEOUT' });
      resolveDeviceClientKindMock.mockResolvedValueOnce('mixed');

      const runtime = auvRuntime.factory(baseContext);
      const result = await runtime.runCommand({ argv: ['invoke', 'display.list'] });

      expect(executeToolCallMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        error: { code: 'COMPUTER_USE_DEVICE_UNAVAILABLE' },
        success: false,
      });
      expect(result.content).toContain('TIMEOUT');
      expect(result.content).toContain('stop `lh connect`');
    });

    it('reports the gateway reason, not a missing capability, when presence is unknown', async () => {
      readDeviceSystemInfoMock.mockResolvedValueOnce({ ok: false, reason: 'DEVICE_NOT_FOUND' });
      resolveDeviceClientKindMock.mockResolvedValueOnce('unknown');

      const runtime = auvRuntime.factory(baseContext);
      const result = await runtime.runCommand({ argv: ['invoke', 'display.list'] });

      expect(executeToolCallMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.content).toContain('DEVICE_NOT_FOUND');
      expect(result.content).not.toContain('does not support');
    });
  });
});
