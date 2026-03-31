import { describe, expect, it, vi } from 'vitest';

// Import after mocks are set up
import { DeviceProxy } from '../deviceProxy';

const mockEnv = vi.hoisted(() => ({
  DEVICE_GATEWAY_SERVICE_TOKEN: undefined as string | undefined,
  DEVICE_GATEWAY_URL: undefined as string | undefined,
}));

const mockClient = vi.hoisted(() => ({
  executeToolCall: vi.fn(),
  getDeviceSystemInfo: vi.fn(),
  queryDeviceList: vi.fn(),
  queryDeviceStatus: vi.fn(),
}));

const MockGatewayHttpClient = vi.hoisted(() => vi.fn(() => mockClient));

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: mockEnv,
}));

vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayHttpClient: MockGatewayHttpClient,
}));

describe('DeviceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.DEVICE_GATEWAY_URL = undefined;
    mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = undefined;
  });

  describe('isConfigured', () => {
    it('should return false when DEVICE_GATEWAY_URL is not set', () => {
      const proxy = new DeviceProxy();
      expect(proxy.isConfigured).toBe(false);
    });

    it('should return true when DEVICE_GATEWAY_URL is set', () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      const proxy = new DeviceProxy();
      expect(proxy.isConfigured).toBe(true);
    });
  });

  describe('queryDeviceStatus', () => {
    it('should return offline status when not configured', async () => {
      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceStatus('user-1');
      expect(result).toEqual({ deviceCount: 0, online: false });
    });

    it('should return status from client on success', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const expected = { deviceCount: 2, online: true };
      mockClient.queryDeviceStatus.mockResolvedValue(expected);

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual(expected);
      expect(mockClient.queryDeviceStatus).toHaveBeenCalledWith('user-1');
    });

    it('should return offline status on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceStatus.mockRejectedValue(new Error('network error'));

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
    });
  });

  describe('queryDeviceList', () => {
    it('should return empty array when not configured', async () => {
      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceList('user-1');
      expect(result).toEqual([]);
    });

    it('should transform connectedAt to lastSeen and set online: true', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const connectedAt = '2025-01-15T10:30:00Z';
      mockClient.queryDeviceList.mockResolvedValue([
        {
          connectedAt,
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          platform: 'darwin',
        },
        {
          connectedAt,
          deviceId: 'dev-2',
          hostname: 'my-desktop',
          platform: 'win32',
        },
      ]);

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([
        {
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          lastSeen: new Date(connectedAt).toISOString(),
          online: true,
          platform: 'darwin',
        },
        {
          deviceId: 'dev-2',
          hostname: 'my-desktop',
          lastSeen: new Date(connectedAt).toISOString(),
          online: true,
          platform: 'win32',
        },
      ]);
      expect(mockClient.queryDeviceList).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceList.mockRejectedValue(new Error('fail'));

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('queryDeviceSystemInfo', () => {
    it('should return undefined when not configured', async () => {
      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');
      expect(result).toBeUndefined();
    });

    it('should return systemInfo on success', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const systemInfo = { cpuModel: 'Apple M1', os: 'macOS', totalMemory: 16384 };
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: true, systemInfo });

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toEqual(systemInfo);
      expect(mockClient.getDeviceSystemInfo).toHaveBeenCalledWith('user-1', 'dev-1');
    });

    it('should return undefined when result is not successful', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: false });

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
    });

    it('should return undefined on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockRejectedValue(new Error('timeout'));

      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
    });
  });

  describe('executeToolCall', () => {
    const params = { deviceId: 'dev-1', userId: 'user-1' };
    const toolCall = { apiName: 'listFiles', arguments: '{}', identifier: 'file-manager' };

    it('should return error when not configured', async () => {
      const proxy = new DeviceProxy();
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

      const proxy = new DeviceProxy();
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

      const proxy = new DeviceProxy();
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

      const proxy = new DeviceProxy();
      const result = await proxy.executeToolCall(params, toolCall);

      expect(result).toEqual({
        content: 'Device tool call error: connection refused',
        error: 'connection refused',
        success: false,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeToolCall.mockRejectedValue('string error');

      const proxy = new DeviceProxy();
      const result = await proxy.executeToolCall(params, toolCall);

      expect(result).toEqual({
        content: 'Device tool call error: string error',
        error: 'string error',
        success: false,
      });
    });
  });

  describe('getClient (lazy initialization)', () => {
    it('should return null when URL is missing', async () => {
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
      expect(MockGatewayHttpClient).not.toHaveBeenCalled();
    });

    it('should return null when token is missing', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      const proxy = new DeviceProxy();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
      expect(MockGatewayHttpClient).not.toHaveBeenCalled();
    });

    it('should create client only once across multiple calls', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceStatus.mockResolvedValue({ deviceCount: 1, online: true });

      const proxy = new DeviceProxy();
      await proxy.queryDeviceStatus('user-1');
      await proxy.queryDeviceStatus('user-2');

      expect(MockGatewayHttpClient).toHaveBeenCalledTimes(1);
      expect(MockGatewayHttpClient).toHaveBeenCalledWith({
        gatewayUrl: 'https://gateway.example.com',
        serviceToken: 'token',
      });
    });
  });
});
