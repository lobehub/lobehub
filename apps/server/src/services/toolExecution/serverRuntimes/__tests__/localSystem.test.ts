import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock deviceGateway
const mockExecuteToolCall = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeToolCall: (...args: any[]) => mockExecuteToolCall(...args),
  },
}));

// Import after mock setup
const { localSystemRuntime } = await import('../localSystem');

describe('localSystemRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have the correct identifier', () => {
    expect(localSystemRuntime.identifier).toBe(LocalSystemIdentifier);
  });

  describe('factory', () => {
    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
      };

      expect(() => localSystemRuntime.factory(context)).toThrow(
        'userId is required for Local System device proxy execution',
      );
    });

    it('should throw when activeDeviceId is missing', () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      expect(() => localSystemRuntime.factory(context)).toThrow(
        'activeDeviceId is required for Local System device proxy execution',
      );
    });

    it('should create a proxy with a function for each API in LocalSystemManifest', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const proxy = localSystemRuntime.factory(context);

      for (const api of LocalSystemManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }
    });

    it('should call deviceGateway.executeToolCall with correct arguments when a proxy function is invoked', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        operationId: 'op-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const expectedResult = { content: 'ok', success: true };
      mockExecuteToolCall.mockResolvedValue(expectedResult);

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;
      const args = { path: '/tmp/test' };

      const result = await proxy[apiName](args);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-1', operationId: 'op-1', userId: 'user-1' },
        {
          apiName,
          arguments: JSON.stringify(args),
          identifier: LocalSystemIdentifier,
        },
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should JSON.stringify the arguments passed to the proxy function', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-2',
        toolManifestMap: {},
        userId: 'user-2',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;
      const complexArgs = { keywords: 'test', fileTypes: ['txt', 'md'], limit: 10 };

      await proxy[apiName](complexArgs);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-2', userId: 'user-2' },
        expect.objectContaining({
          arguments: JSON.stringify(complexArgs),
        }),
        undefined,
      );
    });
  });

  describe('working directory injection', () => {
    const parseArgs = () => JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments);

    const buildProxy = (workingDirectory?: string) => {
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      return localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory,
      });
    };

    it('injects cwd into runCommand when the model omits it', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.runCommand]({ command: 'git status' });

      expect(parseArgs()).toEqual({ command: 'git status', cwd: '/Users/me/repo' });
    });

    it('injects scope into search ops that honor it', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.grepContent]({ pattern: 'TODO' });

      expect(parseArgs()).toEqual({ pattern: 'TODO', scope: '/Users/me/repo' });
    });

    it('does not override an explicit cwd/scope supplied by the model', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.runCommand]({ command: 'ls', cwd: '/explicit' });

      expect(parseArgs()).toEqual({ command: 'ls', cwd: '/explicit' });
    });

    it('injects cwd into file ops so the daemon can resolve a relative path', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.readFile]({ path: 'src/index.ts' });

      // The daemon's resolveAgainstCwd anchors the relative path to cwd; an
      // absolute path the model supplies passes through unchanged there.
      expect(parseArgs()).toEqual({ cwd: '/Users/me/repo', path: 'src/index.ts' });
    });

    it('injects cwd into writeFile / editFile / moveFiles', async () => {
      for (const api of [
        LocalSystemApiName.writeFile,
        LocalSystemApiName.editFile,
        LocalSystemApiName.moveFiles,
      ]) {
        mockExecuteToolCall.mockClear();
        const proxy = buildProxy('/Users/me/repo');
        await proxy[api]({ path: 'x' });
        expect(JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments).cwd).toBe(
          '/Users/me/repo',
        );
      }
    });

    it('does not inject for command-id ops (getCommandOutput / killCommand)', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.getCommandOutput]({ shell_id: 'cmd-1' });

      expect(parseArgs()).toEqual({ shell_id: 'cmd-1' });
    });

    it('leaves args untouched when no working directory is bound', async () => {
      const proxy = buildProxy(undefined);
      await proxy[LocalSystemApiName.runCommand]({ command: 'pwd' });

      expect(parseArgs()).toEqual({ command: 'pwd' });
    });
  });
});
