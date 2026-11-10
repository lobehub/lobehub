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
          {
            method: 'writeLocalFile',
            params: { content: 'next', path: '/proj/src/App.tsx', workspaceRoot: '/proj' },
          },
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

    describe('createProjectFile', () => {
      it('invokes createLocalFile when the path is inside the workspace', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: { path: '/proj/new.ts', success: true },
          success: true,
        });

        const proxy = new DeviceGateway();
        const result = await proxy.createProjectFile({
          deviceId: 'dev-1',
          path: '/proj/new.ts',
          userId: 'user-1',
          workingDirectory: '/proj',
        });

        expect(result).toEqual({ path: '/proj/new.ts', success: true });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
          {
            method: 'createLocalFile',
            params: { content: undefined, path: '/proj/new.ts', workspaceRoot: '/proj' },
          },
        );
      });

      it('throws without invoking the rpc when the path escapes the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.createProjectFile({
            deviceId: 'dev-1',
            path: '/proj/../evil.sh',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('surfaces a device that has not shipped the rpc yet as an error', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          error: 'Unknown device RPC method: createLocalFile',
          success: false,
        });

        const proxy = new DeviceGateway();
        await expect(
          proxy.createProjectFile({
            deviceId: 'dev-1',
            path: '/proj/new.ts',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow('Unknown device RPC method: createLocalFile');
      });
    });

    describe('createProjectDirectory', () => {
      it('invokes createLocalDirectory when the path is inside the workspace', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: { path: '/proj/src/new', success: true },
          success: true,
        });

        const proxy = new DeviceGateway();
        await expect(
          proxy.createProjectDirectory({
            deviceId: 'dev-1',
            path: '/proj/src/new',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).resolves.toEqual({ path: '/proj/src/new', success: true });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
          {
            method: 'createLocalDirectory',
            params: { path: '/proj/src/new', workspaceRoot: '/proj' },
          },
        );
      });

      it('throws without invoking the rpc when the path escapes the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.createProjectDirectory({
            deviceId: 'dev-1',
            path: '/tmp/outside',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });
    });

    describe('createDirectory', () => {
      it('creates one child of the browsed folder, scoped to that folder', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: { path: '/home/me/new-project', success: true },
          success: true,
        });

        const proxy = new DeviceGateway();
        await expect(
          proxy.createDirectory({
            deviceId: 'dev-1',
            name: ' new-project ',
            parentPath: '/home/me/',
            userId: 'user-1',
          }),
        ).resolves.toEqual({ path: '/home/me/new-project', success: true });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
          {
            method: 'createLocalDirectory',
            params: { path: '/home/me/new-project', workspaceRoot: '/home/me/' },
          },
        );
      });

      it.each([
        ['/', '/new'],
        ['C:\\Users\\me', 'C:\\Users\\me\\new'],
        ['C:\\', 'C:\\new'],
      ])('joins %s with the device separator', async (parentPath, expected) => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: { path: expected, success: true },
          success: true,
        });

        await new DeviceGateway().createDirectory({
          deviceId: 'dev-1',
          name: 'new',
          parentPath,
          userId: 'user-1',
        });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(expect.anything(), {
          method: 'createLocalDirectory',
          params: { path: expected, workspaceRoot: parentPath },
        });
      });

      it.each(['', '.', '..', 'a/b', 'a\\b'])(
        'rejects the folder name %j without invoking the rpc',
        async (name) => {
          configure();

          await expect(
            new DeviceGateway().createDirectory({
              deviceId: 'dev-1',
              name,
              parentPath: '/home/me',
              userId: 'user-1',
            }),
          ).rejects.toThrow(/Invalid folder name/);
          expect(mockClient.invokeRpc).not.toHaveBeenCalled();
        },
      );

      it.each(['a:b', 'CON.txt', 'project.', 'project '])(
        'rejects invalid Windows name %j before invoking the device',
        async (name) => {
          configure();
          await expect(
            new DeviceGateway().createDirectory({
              deviceId: 'dev-1',
              name,
              parentPath: 'C:\\Users\\me',
              userId: 'user-1',
            }),
          ).rejects.toThrow(/Invalid folder name/);
          expect(mockClient.invokeRpc).not.toHaveBeenCalled();
        },
      );

      it('rejects a relative parent path without invoking the rpc', async () => {
        configure();

        await expect(
          new DeviceGateway().createDirectory({
            deviceId: 'dev-1',
            name: 'new',
            parentPath: 'relative/dir',
            userId: 'user-1',
          }),
        ).rejects.toThrow(/must be absolute/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('returns a device-reported failure instead of throwing', async () => {
        configure();
        const failure = {
          error: 'An item already exists at /home/me/new.',
          path: '/home/me/new',
          success: false,
        };
        mockClient.invokeRpc.mockResolvedValue({ data: failure, success: true });

        await expect(
          new DeviceGateway().createDirectory({
            deviceId: 'dev-1',
            name: 'new',
            parentPath: '/home/me',
            userId: 'user-1',
          }),
        ).resolves.toEqual(failure);
      });

      it('throws when the rpc itself fails', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({ error: 'Device offline', success: false });

        await expect(
          new DeviceGateway().createDirectory({
            deviceId: 'dev-1',
            name: 'new',
            parentPath: '/home/me',
            userId: 'user-1',
          }),
        ).rejects.toThrow('Device offline');
      });
    });

    describe('copyProjectFiles', () => {
      it('invokes copyLocalFiles when source and target stay inside the workspace', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: [{ sourcePath: '/proj/a.ts', success: true, targetPath: '/proj/a copy.ts' }],
          success: true,
        });

        const proxy = new DeviceGateway();
        const items = [
          { sourcePath: '/proj/a.ts' },
          { sourcePath: '/proj/b', targetPath: '/proj/c' },
        ];
        await proxy.copyProjectFiles({
          deviceId: 'dev-1',
          items,
          userId: 'user-1',
          workingDirectory: '/proj',
        });

        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 60_000, userId: 'user-1' },
          { method: 'copyLocalFiles', params: { items, workspaceRoot: '/proj' } },
        );
      });

      it('throws when a source lies outside the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.copyProjectFiles({
            deviceId: 'dev-1',
            items: [{ sourcePath: '/Users/me/.ssh/id_rsa', targetPath: '/proj/key' }],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('throws when a target lies outside the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.copyProjectFiles({
            deviceId: 'dev-1',
            items: [{ sourcePath: '/proj/secrets.env', targetPath: '/tmp/exfil.env' }],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('refuses to duplicate the workspace root (the copy would land outside it)', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.copyProjectFiles({
            deviceId: 'dev-1',
            items: [{ sourcePath: '/proj' }],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/workspace root/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });
    });

    describe('trashProjectFiles', () => {
      it('invokes trashLocalFiles when every path is inside the workspace', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          data: { items: [{ path: '/proj/a.ts', success: true }], success: true },
          success: true,
        });

        const proxy = new DeviceGateway();
        await expect(
          proxy.trashProjectFiles({
            deviceId: 'dev-1',
            paths: ['/proj/a.ts'],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).resolves.toEqual({ items: [{ path: '/proj/a.ts', success: true }], success: true });
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(
          { deviceId: 'dev-1', timeout: 30_000, userId: 'user-1' },
          { method: 'trashLocalFiles', params: { paths: ['/proj/a.ts'], workspaceRoot: '/proj' } },
        );
      });

      it('throws when any path escapes the workspace', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.trashProjectFiles({
            deviceId: 'dev-1',
            paths: ['/proj/a.ts', '/Users/me/Documents'],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/outside the approved workspace/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it.each(['/proj', '/proj/', '/proj/src/..'])(
        'refuses to trash the workspace root itself (%s)',
        async (rootPath) => {
          configure();
          const proxy = new DeviceGateway();

          await expect(
            proxy.trashProjectFiles({
              deviceId: 'dev-1',
              paths: [rootPath],
              userId: 'user-1',
              workingDirectory: '/proj',
            }),
          ).rejects.toThrow(/workspace root/);
          expect(mockClient.invokeRpc).not.toHaveBeenCalled();
        },
      );

      it('surfaces a device without a trash as an error, not a delete', async () => {
        configure();
        mockClient.invokeRpc.mockResolvedValue({
          error: 'This device does not support moving files to the trash',
          success: false,
        });

        const proxy = new DeviceGateway();
        await expect(
          proxy.trashProjectFiles({
            deviceId: 'dev-1',
            paths: ['/proj/a.ts'],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow('This device does not support moving files to the trash');
        expect(mockClient.invokeRpc).toHaveBeenCalledTimes(1);
      });
    });

    describe('workspace root guard on rename / move', () => {
      it('refuses to rename the workspace root itself', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.renameProjectFile({
            deviceId: 'dev-1',
            newName: 'renamed',
            path: '/proj',
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/workspace root/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('refuses to move the workspace root itself', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.moveProjectFiles({
            deviceId: 'dev-1',
            items: [{ newPath: '/proj/inner', oldPath: '/proj' }],
            userId: 'user-1',
            workingDirectory: '/proj',
          }),
        ).rejects.toThrow(/workspace root/);
        expect(mockClient.invokeRpc).not.toHaveBeenCalled();
      });

      it('contains Windows workspace roots with Windows semantics', async () => {
        configure();
        const proxy = new DeviceGateway();

        await expect(
          proxy.trashProjectFiles({
            deviceId: 'dev-1',
            paths: ['C:\\proj\\'],
            userId: 'user-1',
            workingDirectory: 'C:\\proj',
          }),
        ).rejects.toThrow(/workspace root/);
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
            params: {
              items: [{ newPath: '/proj/b.ts', oldPath: '/proj/a.ts' }],
              workspaceRoot: '/proj',
            },
          },
        );
      });
    });
  });
});
