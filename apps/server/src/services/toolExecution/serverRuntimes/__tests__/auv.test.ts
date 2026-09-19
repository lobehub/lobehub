import { AuvApiName, AuvIdentifier } from '@lobechat/builtin-tool-auv';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const executeToolCallMock = vi.fn();
const queryDeviceSystemInfoMock = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    queryDeviceSystemInfo: (...args: unknown[]) => queryDeviceSystemInfoMock(...args),
  },
}));
vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    executeToolCallMock(...args),
}));

const { auvRuntime } = await import('../auv');

describe('auvRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryDeviceSystemInfoMock.mockResolvedValue({ supportedTools: [AuvIdentifier] });
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
    queryDeviceSystemInfoMock.mockResolvedValueOnce({ arch: 'arm64' });
    const runtime = auvRuntime.factory({
      userId: 'user-1',
      activeDeviceId: 'device-1',
      toolManifestMap: {},
    });
    await expect(runtime.runCommand({ argv: ['invoke', 'display.list'] })).rejects.toThrow(
      'does not support Computer Use',
    );
    expect(executeToolCallMock).not.toHaveBeenCalled();
  });

  it('proxies runCommand to the active desktop device', async () => {
    const context: ToolExecutionContext = {
      activeDeviceId: 'device-1',
      operationId: 'operation-1',
      toolManifestMap: {},
      userId: 'user-1',
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
  });
});
