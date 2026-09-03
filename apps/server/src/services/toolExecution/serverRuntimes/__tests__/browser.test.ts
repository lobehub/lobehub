import { BrowserIdentifier, BrowserManifest } from '@lobechat/builtin-tool-browser';
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
const { browserRuntime } = await import('../browser');

describe('browserRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have the correct identifier', () => {
    expect(browserRuntime.identifier).toBe(BrowserIdentifier);
  });

  describe('factory', () => {
    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
      };

      expect(() => browserRuntime.factory(context)).toThrow(
        'userId is required for Browser device proxy execution',
      );
    });

    it('should throw when agentId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      expect(() => browserRuntime.factory(context)).toThrow(
        'agentId is required for Browser device proxy execution',
      );
    });

    it('should return a structured NO_ACTIVE_DEVICE result per API when activeDeviceId is missing', async () => {
      const context: ToolExecutionContext = {
        agentId: 'agt-1',
        // Device-unrouted run WITH the picker still advertised: recovery via
        // lobe-remote-device activation is possible.
        toolManifestMap: { 'lobe-remote-device': {} as any },
        userId: 'user-1',
      };

      const proxy = browserRuntime.factory(context) as Record<string, (args: any) => Promise<any>>;

      // Every manifest API is present (not a throw), and each returns the
      // structured, recoverable error instead of an opaque failure.
      for (const api of BrowserManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }

      const result = await proxy[BrowserManifest.api[0].name]({ url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'NO_ACTIVE_DEVICE' });
      expect(result.content).toContain('lobe-remote-device.listOnlineDevices');
      expect(result.content).toContain('activateDevice');
      expect(result.content).toContain('desktop application or cli');
      // No device dispatch happened.
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

    it('should point at user reconnection when the remote-device picker is not in the manifest', async () => {
      const context: ToolExecutionContext = {
        agentId: 'agt-1',
        toolManifestMap: {
          'lobe-browser': {} as any,
        },
        userId: 'user-1',
      };

      const proxy = browserRuntime.factory(context) as Record<string, (args: any) => Promise<any>>;
      const result = await proxy[BrowserManifest.api[0].name]({});

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'NO_ACTIVE_DEVICE' });
      expect(result.content).toContain('locked to a specific device');
      expect(result.content).not.toContain('activateDevice');
    });

    it('should create a proxy with a function for each API in BrowserManifest when a device is active', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        agentId: 'agt-1',
        topicId: 'tpc-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const proxy = browserRuntime.factory(context) as Record<string, () => any>;

      for (const api of BrowserManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }
    });
  });
});
