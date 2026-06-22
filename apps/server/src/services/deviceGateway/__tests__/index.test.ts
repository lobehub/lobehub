import { describe, expect, it, vi } from 'vitest';

// Import after mocks are set up
import { DeviceGateway } from '../index';

const mockEnv = vi.hoisted(() => ({
  DEVICE_GATEWAY_SERVICE_TOKEN: undefined as string | undefined,
  DEVICE_GATEWAY_URL: undefined as string | undefined,
}));

const mockClient = vi.hoisted(() => ({
  executeMcpCall: vi.fn(),
  executeMessageApi: vi.fn(),
  executeToolCall: vi.fn(),
  getDeviceSystemInfo: vi.fn(),
  invokeRpc: vi.fn(),
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

describe('DeviceGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.DEVICE_GATEWAY_URL = undefined;
    mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = undefined;
  });

  describe('isConfigured', () => {
    it('should return false when DEVICE_GATEWAY_URL is not set', () => {
      const proxy = new DeviceGateway();
      expect(proxy.isConfigured).toBe(false);
    });

    it('should return true when DEVICE_GATEWAY_URL is set', () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      const proxy = new DeviceGateway();
      expect(proxy.isConfigured).toBe(true);
    });
  });

  describe('queryDeviceStatus', () => {
    it('should return offline status when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');
      expect(result).toEqual({ deviceCount: 0, online: false });
    });

    it('should return status from client on success', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const expected = { deviceCount: 2, online: true };
      mockClient.queryDeviceStatus.mockResolvedValue(expected);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual(expected);
      expect(mockClient.queryDeviceStatus).toHaveBeenCalledWith('user-1', undefined);
    });

    it('should return offline status on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceStatus.mockRejectedValue(new Error('network error'));

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
    });
  });

  describe('queryDeviceList', () => {
    it('should return empty array when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');
      expect(result).toEqual([]);
    });

    it('should map device-centric channels to lastSeen + online and flatten channels', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const connectedAt = Date.parse('2025-01-15T10:30:00Z');
      const iso = new Date(connectedAt).toISOString();
      mockClient.queryDeviceList.mockResolvedValue([
        {
          channels: [
            { channel: 'desktop', connectedAt, connectionId: 'conn-a' },
            { channel: 'cli', connectedAt, connectionId: 'conn-b' },
          ],
          connectedAt,
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          platform: 'darwin',
        },
        {
          channels: [{ channel: 'desktop', connectedAt, connectionId: 'conn-c' }],
          connectedAt,
          deviceId: 'dev-2',
          hostname: 'my-desktop',
          platform: 'win32',
        },
      ]);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([
        {
          channels: [
            { channel: 'desktop', connectedAt: iso, connectionId: 'conn-a' },
            { channel: 'cli', connectedAt: iso, connectionId: 'conn-b' },
          ],
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          lastSeen: iso,
          online: true,
          platform: 'darwin',
        },
        {
          channels: [{ channel: 'desktop', connectedAt: iso, connectionId: 'conn-c' }],
          deviceId: 'dev-2',
          hostname: 'my-desktop',
          lastSeen: iso,
          online: true,
          platform: 'win32',
        },
      ]);
      expect(mockClient.queryDeviceList).toHaveBeenCalledWith('user-1', undefined);
    });

    it('tolerates a legacy gateway response without channels', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const connectedAt = Date.parse('2025-01-15T10:30:00Z');
      mockClient.queryDeviceList.mockResolvedValue([
        { connectedAt, deviceId: 'dev-1', hostname: 'my-laptop', platform: 'darwin' },
      ]);

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([
        {
          channels: [],
          deviceId: 'dev-1',
          hostname: 'my-laptop',
          lastSeen: new Date(connectedAt).toISOString(),
          online: true,
          platform: 'darwin',
        },
      ]);
    });

    it('should return empty array on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceList.mockRejectedValue(new Error('fail'));

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceList('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('queryDeviceSystemInfo', () => {
    it('should return undefined when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');
      expect(result).toBeUndefined();
    });

    it('should return systemInfo on success', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const systemInfo = { cpuModel: 'Apple M1', os: 'macOS', totalMemory: 16384 };
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: true, systemInfo });

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toEqual(systemInfo);
      expect(mockClient.getDeviceSystemInfo).toHaveBeenCalledWith('user-1', 'dev-1', undefined);
    });

    it('should return undefined when result is not successful', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockResolvedValue({ success: false });

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
    });

    it('should return undefined on error', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.getDeviceSystemInfo.mockRejectedValue(new Error('timeout'));

      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceSystemInfo('user-1', 'dev-1');

      expect(result).toBeUndefined();
    });
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

      const proxy = new DeviceGateway();
      const result = await proxy.executeToolCall(params, toolCall);

      expect(result).toEqual({
        content: 'Device tool call error: string error',
        error: 'string error',
        success: false,
      });
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

    it('should return error result on exception', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.executeMcpCall.mockRejectedValue(new Error('connection refused'));

      const proxy = new DeviceGateway();
      const result = await proxy.executeMcpCall(mcpCall);

      expect(result).toEqual({
        content: 'Device MCP call error: connection refused',
        error: 'connection refused',
        success: false,
      });
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

  describe('initWorkspace', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    it('should return undefined when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });
      expect(result).toBeUndefined();
      expect(mockClient.invokeRpc).not.toHaveBeenCalled();
    });

    it('narrows device skills to metadata and passes instructions through', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({
        data: {
          instructions: [{ content: '# Rules', source: 'AGENTS.md' }],
          // Device returns rich ProjectSkillItems; only name/description/path survive.
          skills: [
            {
              description: 'spa',
              fileCount: 3,
              files: ['SKILL.md'],
              name: 'spa-routes',
              path: '/proj/.agents/skills/spa-routes/SKILL.md',
              skillDir: '/proj/.agents/skills/spa-routes',
              source: '.agents/skills',
            },
          ],
        },
        success: true,
      });

      const proxy = new DeviceGateway();
      const result = await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toEqual({
        instructions: [{ content: '# Rules', source: 'AGENTS.md' }],
        skills: [
          {
            description: 'spa',
            name: 'spa-routes',
            path: '/proj/.agents/skills/spa-routes/SKILL.md',
          },
        ],
      });
      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        { method: 'initWorkspace', params: { scope: '/proj' } },
      );
    });

    it('defaults instructions and skills to empty arrays when absent', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ data: {}, success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toEqual({ instructions: [], skills: [] });
    });

    it('returns undefined when the rpc reports failure', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ error: 'offline', success: false });

      const proxy = new DeviceGateway();
      const result = await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined when the rpc succeeds without data', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined on exception', async () => {
      configure();
      mockClient.invokeRpc.mockRejectedValue(new Error('timeout'));

      const proxy = new DeviceGateway();
      const result = await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('forwards a custom timeout', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({
        data: { instructions: [], skills: [] },
        success: true,
      });

      const proxy = new DeviceGateway();
      await proxy.initWorkspace({
        deviceId: 'dev-1',
        scope: '/proj',
        timeout: 60_000,
        userId: 'user-1',
      });

      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 60_000, userId: 'user-1' },
        { method: 'initWorkspace', params: { scope: '/proj' } },
      );
    });
  });

  describe('listProjectSkills', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    it('should return undefined when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.listProjectSkills({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });
      expect(result).toBeUndefined();
      expect(mockClient.invokeRpc).not.toHaveBeenCalled();
    });

    it('passes the device result through and invokes the rpc with scope', async () => {
      configure();
      const data = {
        root: '/proj',
        skills: [
          {
            description: 'spa',
            fileCount: 3,
            files: ['SKILL.md'],
            name: 'spa-routes',
            path: '/proj/.agents/skills/spa-routes/SKILL.md',
            skillDir: '/proj/.agents/skills/spa-routes',
            source: '.agents/skills',
          },
        ],
        source: '.agents/skills',
      };
      mockClient.invokeRpc.mockResolvedValue({ data, success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.listProjectSkills({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toEqual(data);
      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        { method: 'listProjectSkills', params: { scope: '/proj' } },
      );
    });

    it('returns undefined when the rpc reports failure', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ error: 'offline', success: false });

      const proxy = new DeviceGateway();
      const result = await proxy.listProjectSkills({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined when the rpc succeeds without data', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.listProjectSkills({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined on exception', async () => {
      configure();
      mockClient.invokeRpc.mockRejectedValue(new Error('timeout'));

      const proxy = new DeviceGateway();
      const result = await proxy.listProjectSkills({
        deviceId: 'dev-1',
        scope: '/proj',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('forwards a custom timeout', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({
        data: { root: '/proj', skills: [], source: null },
        success: true,
      });

      const proxy = new DeviceGateway();
      await proxy.listProjectSkills({
        deviceId: 'dev-1',
        scope: '/proj',
        timeout: 60_000,
        userId: 'user-1',
      });

      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 60_000, userId: 'user-1' },
        { method: 'listProjectSkills', params: { scope: '/proj' } },
      );
    });
  });

  describe('getLocalFilePreview', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    it('returns an error result when not configured', async () => {
      const proxy = new DeviceGateway();
      const result = await proxy.getLocalFilePreview({
        deviceId: 'dev-1',
        path: '/proj/App.tsx',
        userId: 'user-1',
        workingDirectory: '/proj',
      });

      expect(result).toEqual({ error: 'Device gateway not configured', success: false });
      expect(mockClient.invokeRpc).not.toHaveBeenCalled();
    });

    it('passes the device preview result through and invokes the rpc', async () => {
      configure();
      const data = {
        preview: {
          content: 'const value = 1;',
          contentType: 'text/plain',
          type: 'text',
        },
        success: true,
      };
      mockClient.invokeRpc.mockResolvedValue({ data, success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.getLocalFilePreview({
        deviceId: 'dev-1',
        path: '/proj/App.tsx',
        userId: 'user-1',
        workingDirectory: '/proj',
      });

      expect(result).toEqual(data);
      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        {
          method: 'getLocalFilePreview',
          params: { accept: undefined, path: '/proj/App.tsx', workingDirectory: '/proj' },
        },
      );
    });

    it('forwards image-only preview constraints to the device rpc', async () => {
      configure();
      const data = {
        preview: {
          base64: 'aW1hZ2U=',
          contentType: 'image/png',
          type: 'image',
        },
        success: true,
      };
      mockClient.invokeRpc.mockResolvedValue({ data, success: true });

      const proxy = new DeviceGateway();
      await proxy.getLocalFilePreview({
        accept: 'image',
        deviceId: 'dev-1',
        path: '/proj/image.png',
        userId: 'user-1',
        workingDirectory: '/proj',
      });

      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        {
          method: 'getLocalFilePreview',
          params: { accept: 'image', path: '/proj/image.png', workingDirectory: '/proj' },
        },
      );
    });

    it('returns an error result when the rpc reports failure', async () => {
      configure();
      mockClient.invokeRpc.mockResolvedValue({ error: 'offline', success: false });

      const proxy = new DeviceGateway();
      const result = await proxy.getLocalFilePreview({
        deviceId: 'dev-1',
        path: '/proj/App.tsx',
        userId: 'user-1',
        workingDirectory: '/proj',
      });

      expect(result).toEqual({ error: 'offline', success: false });
    });
  });

  describe('file mutation containment', () => {
    const configure = () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
    };

    describe('writeProjectFile', () => {
      it('invokes the rpc when the path is inside the workspace', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({ data: { success: true }, success: true });

        const proxy = new DeviceGateway();
        const result = await proxy.writeProjectFile({
          content: 'next',
          deviceId: 'dev-1',
          path: '/proj/src/App.tsx',
          userId: 'user-1',
          workingDirectory: '/proj',
        });

        expect(result).toEqual({ success: true });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
          { method: 'writeLocalFile', params: { content: 'next', path: '/proj/src/App.tsx' } },
        );
      });

      it('throws without invoking the rpc when the path escapes the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.writeProjectFile({
            content: 'pwned',
            deviceId: 'dev-1',
            path: '/etc/passwd',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('rejects a `..` traversal that resolves outside the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.writeProjectFile({
            content: 'pwned',
            deviceId: 'dev-1',
            path: '/proj/../secrets.env',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('contains Windows device paths using Windows path semantics', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.writeProjectFile({
            content: 'pwned',
            deviceId: 'dev-1',
            path: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
            userId: 'user-1',
            workingDirectory: 'C:\\proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });
    });

    describe('renameProjectFile', () => {
      it('throws without invoking the rpc when the path escapes the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.renameProjectFile({
            deviceId: 'dev-1',
            newName: 'evil.ts',
            path: '/etc/hosts',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });
    });

    describe('moveProjectFiles', () => {
      it('throws when any item moves out of the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.moveProjectFiles({
            deviceId: 'dev-1',
            items: [
              { newPath: '/proj/b.ts', oldPath: '/proj/a.ts' },
              { newPath: '/tmp/exfil.ts', oldPath: '/proj/c.ts' },
            ],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('invokes the rpc when every item stays inside the workspace', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: [{ newPath: '/proj/b.ts', sourcePath: '/proj/a.ts', success: true }],
          success: true,
        });

        const proxy = new DeviceGateway();
        const result = await proxy.moveProjectFiles({
          deviceId: 'dev-1',
          items: [{ newPath: '/proj/b.ts', oldPath: '/proj/a.ts' }],
          userId: 'user-1',
          workingDirectory: '/proj',
        });

        expect(result).toEqual([
          { newPath: '/proj/b.ts', sourcePath: '/proj/a.ts', success: true },
        ]);
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
          {
            method: 'moveLocalFiles',
            params: { items: [{ newPath: '/proj/b.ts', oldPath: '/proj/a.ts' }] },
          },
        );
      });
    });
  });

  describe('getClient (lazy initialization)', () => {
    it('should return null when URL is missing', async () => {
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
      expect(MockGatewayHttpClient).not.toHaveBeenCalled();
    });

    it('should return null when token is missing', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      const proxy = new DeviceGateway();
      const result = await proxy.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
      expect(MockGatewayHttpClient).not.toHaveBeenCalled();
    });

    it('should create client only once across multiple calls', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.queryDeviceStatus.mockResolvedValue({ deviceCount: 1, online: true });

      const proxy = new DeviceGateway();
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
