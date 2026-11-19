import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from '.';
import { mockClient, mockEnv, resetGatewayMocks } from './testUtils';

vi.mock('@/server/services/redis/client', () =>
  import('./testUtils').then((m) => ({ getRedisServiceClient: m.getRedisServiceClient })),
);

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => ({ gatewayEnv: m.mockEnv })));

// Partial mock: only the HTTP client is swapped. The transport-failure
// describers are pure functions the service calls to phrase its errors, and
// stubbing them would test nothing.
vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayHttpClient: (await import('./testUtils')).MockGatewayHttpClient,
}));

describe('DeviceGateway', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  describe('executeToolCall', () => {
    const params = { deviceId: 'dev-1', userId: 'user-1' };
    const toolCall = { apiName: 'listFiles', arguments: '{}', identifier: 'file-manager' };

    it('should return error when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.executeToolCall(params, toolCall);

      expect(result).toEqual({
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      });
    });

    it('should execute tool call with default timeout', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const expected = { content: 'file list', success: true };
      mockClient.executeToolCall.mockResolvedValue(expected);

      const proxy = new DeviceGateway();
      const result = await proxy.executeToolCall(params, toolCall);

      expect(result).toEqual(expected);
      expect(mockClient.executeToolCall).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        toolCall,
      );
    });

    it('should use custom timeout', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeToolCall.mockResolvedValue({ content: 'ok', success: true });

      const proxy = new DeviceGateway();
      await proxy.executeToolCall(params, toolCall, 60_000);

      expect(mockClient.executeToolCall).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 60_000, userId: 'user-1' },
        toolCall,
      );
    });

    it('should return error result on Error exception', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeToolCall.mockRejectedValue(new Error('connection refused'));

      const proxy = new DeviceGateway();
      const result = await proxy.executeToolCall(params, toolCall);

      // `connection refused` is a network failure, so the model is told the call
      // never ran rather than being handed the bare driver message.
      expect(result.success).toBe(false);
      expect(result.content).toContain('Could not reach the device gateway');
      expect(result.error).toBe('DEVICE_GATEWAY_UNREACHABLE: connection refused');
    });

    it('should handle non-Error exceptions', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeToolCall.mockRejectedValue('string error');

      const proxy = new DeviceGateway();
      const result = await proxy.executeToolCall(params, toolCall);

      // Unrecognised cause: describe the hop without claiming to know whether
      // the device ran the call.
      expect(result.success).toBe(false);
      expect(result.content).toContain('unclear whether the device ran it');
      expect(result.error).toBe('DEVICE_GATEWAY_ERROR: string error');
    });
  });

  describe('executeMcpCall', () => {
    const mcpCall = {
      apiName: 'getStock',
      arguments: '{"symbol":"AAPL"}',
      deviceId: 'dev-1',
      identifier: 'kimi-datasource',
      params: {
        args: ['stock-mcp'],
        command: 'npx',
        env: { TOKEN: 'secret' },
        name: 'kimi-datasource',
        type: 'stdio' as const,
      },
      userId: 'user-1',
    };

    it('should return error when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.executeMcpCall(mcpCall);

      expect(result).toEqual({
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      });
    });

    it('should forward the mcp call with default timeout', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const expected = { content: 'stock data', state: { rows: 3 }, success: true };
      mockClient.executeMcpCall.mockResolvedValue(expected);

      const proxy = new DeviceGateway();
      const result = await proxy.executeMcpCall(mcpCall);

      expect(result).toEqual(expected);
      expect(mockClient.executeMcpCall).toHaveBeenCalledWith({ ...mcpCall, timeout: 30_000 });
    });

    it('should use custom timeout', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeMcpCall.mockResolvedValue({ content: 'ok', success: true });

      const proxy = new DeviceGateway();
      await proxy.executeMcpCall(mcpCall, 60_000);

      expect(mockClient.executeMcpCall).toHaveBeenCalledWith({ ...mcpCall, timeout: 60_000 });
    });

    it('names an lh connect too old for MCP calls instead of an unknown tool', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      // CLI 0.0.78 dispatches every call by apiName among its built-in tools
      mockClient.executeMcpCall.mockResolvedValue({
        content: '',
        error: 'Unknown tool API: getStock',
        success: false,
      });

      const result = await new DeviceGateway().executeMcpCall(mcpCall);

      expect(result).toEqual({
        content: expect.stringContaining('`lh connect` too old for MCP servers'),
        error: 'MCP_DEVICE_CLIENT_OUTDATED',
        success: false,
      });
      expect(result.content).toContain("MCP tool 'getStock' of 'kimi-datasource' did not run");
      expect(result.content).toContain('lh update');
    });

    it("passes the MCP server's own failure through", async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const failure = { content: 'Unknown tool API: other', error: 'boom', success: false };
      mockClient.executeMcpCall.mockResolvedValue(failure);

      expect(await new DeviceGateway().executeMcpCall(mcpCall)).toEqual(failure);
    });

    it('should return error result on exception', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeMcpCall.mockRejectedValue(new Error('connection refused'));

      const proxy = new DeviceGateway();
      const result = await proxy.executeMcpCall(mcpCall);

      // Tunneled MCP calls ride the same relay, so they get the same phrasing.
      expect(result.success).toBe(false);
      expect(result.content).toContain('Could not reach the device gateway');
      expect(result.error).toBe('DEVICE_GATEWAY_UNREACHABLE: connection refused');
    });
  });

  describe('executeMessageApi', () => {
    const params = { deviceId: 'dev-1', userId: 'user-1' };
    const api = { apiName: 'sendText', payload: { chatGuid: 'chat-1' }, platform: 'imessage' };

    it('should return error when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.executeMessageApi(params, api);

      expect(result).toEqual({
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      });
    });

    it('should execute message API with default timeout', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const expected = { content: '{"ok":true}', success: true };
      mockClient.executeMessageApi.mockResolvedValue(expected);

      const proxy = new DeviceGateway();
      const result = await proxy.executeMessageApi(params, api);

      expect(result).toEqual(expected);
      expect(mockClient.executeMessageApi).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        api,
      );
    });

    it('should use custom timeout', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeMessageApi.mockResolvedValue({ content: 'ok', success: true });

      const proxy = new DeviceGateway();
      await proxy.executeMessageApi(params, api, 60_000);

      expect(mockClient.executeMessageApi).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 60_000, userId: 'user-1' },
        api,
      );
    });

    it('should return error result on exception', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeMessageApi.mockRejectedValue(new Error('connection refused'));

      const proxy = new DeviceGateway();
      const result = await proxy.executeMessageApi(params, api);

      expect(result).toEqual({
        content: 'Device message API error: connection refused',
        error: 'connection refused',
        success: false,
      });
    });
  });
});
