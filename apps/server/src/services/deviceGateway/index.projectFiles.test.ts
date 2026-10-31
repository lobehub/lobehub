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
          // Device returns rich ProjectSkillItems; only prompt metadata survives.
          skills: [
            {
              description: 'spa',
              fileCount: 3,
              files: ['SKILL.md'],
              name: 'spa-routes',
              path: '/proj/.agents/skills/spa-routes/SKILL.md',
              previewRoot: '/proj',
              scope: 'project',
              skillDir: '/proj/.agents/skills/spa-routes',
              source: '.agents/skills',
            },
            {
              description: 'device',
              fileCount: 2,
              files: ['SKILL.md', 'refs.md'],
              name: 'device-writer',
              path: '/home/.agents/skills/device-writer/SKILL.md',
              previewRoot: '/home/.agents/skills',
              scope: 'device',
              skillDir: '/home/.agents/skills/device-writer',
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
            scope: 'project',
          },
          {
            description: 'device',
            name: 'device-writer',
            path: '/home/.agents/skills/device-writer/SKILL.md',
            scope: 'device',
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
            previewRoot: '/proj',
            scope: 'project',
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

  describe('readExternalAssetForPublish', () => {
    it('invokes only the dedicated publish RPC method', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const data = { base64: 'AQID', contentType: 'image/png', success: true };
      mockClient.invokeRpc.mockResolvedValue({ data, success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.readExternalAssetForPublish({
        deviceId: 'dev-1',
        path: '/outside/image.png',
        userId: 'user-1',
        workingDirectory: '/proj',
      });

      expect(result).toEqual(data);
      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        {
          method: 'readExternalAssetForPublish',
          params: { path: '/outside/image.png', workingDirectory: '/proj' },
        },
      );
    });
  });

  describe('copyAssetForPublish', () => {
    it('invokes the copy RPC when the destination is inside the workspace', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      mockClient.invokeRpc.mockResolvedValue({ data: { success: true }, success: true });

      const proxy = new DeviceGateway();
      const result = await proxy.copyAssetForPublish({
        deviceId: 'dev-1',
        from: '/outside/image.png',
        to: '/proj/.lobe-artifacts/site/image.png',
        userId: 'user-1',
        workingDirectory: '/proj',
      });

      expect(result).toEqual({ success: true });
      expect(mockClient.invokeRpc).toHaveBeenCalledWith(
        { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
        {
          method: 'copyAssetForPublish',
          params: {
            from: '/outside/image.png',
            to: '/proj/.lobe-artifacts/site/image.png',
            workingDirectory: '/proj',
          },
        },
      );
    });

    it('throws without invoking the rpc when the destination escapes the workspace', async () => {
      mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
      mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
      const proxy = new DeviceGateway();

      await expect(
        proxy.copyAssetForPublish({
          deviceId: 'dev-1',
          from: '/outside/image.png',
          to: '/proj/../image.png',
          userId: 'user-1',
          workingDirectory: '/proj',
        }),
      ).rejects.toThrow(/outside the approved workspace/);
      expect(mockClient.invokeRpc).not.toHaveBeenCalled();
    });
  });
});
