import { LocalSystemIdentifier, LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock deviceProxy
const mockExecuteToolCall = vi.fn();
vi.mock('../../deviceProxy', () => ({
  deviceProxy: {
    executeToolCall: (...args: any[]) => mockExecuteToolCall(...args),
  },
}));

// Import after mock setup
const { localSystemRuntime } = await import('../localSystem');

describe('localSystemRuntime', () => {
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

    it('should call deviceProxy.executeToolCall with correct arguments when a proxy function is invoked', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
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
        { deviceId: 'device-1', userId: 'user-1' },
        {
          apiName,
          arguments: JSON.stringify(args),
          identifier: LocalSystemIdentifier,
        },
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
      );
    });
  });
});
