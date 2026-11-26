import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProtocolScheme, parseProtocolUrl } from '@/utils/protocol';

import type { App as AppCore } from '../../App';
import { ProtocolManager } from '../ProtocolManager';

// Use vi.hoisted to define mocks before hoisting
const { mockApp, mockGetProtocolScheme, mockParseProtocolUrl } = vi.hoisted(() => ({
  mockApp: {
    getPath: vi.fn().mockReturnValue('/mock/exe/path'),
    isDefaultProtocolClient: vi.fn().mockReturnValue(true),
    isReady: vi.fn().mockReturnValue(true),
    name: 'LobeHub',
    on: vi.fn(),
    setAsDefaultProtocolClient: vi.fn().mockReturnValue(true),
  },
  mockGetProtocolScheme: vi.fn().mockReturnValue('lobehub'),
  mockParseProtocolUrl: vi.fn(),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: mockApp,
}));

// Mock protocol utils
vi.mock('@/utils/protocol', () => ({
  getProtocolScheme: mockGetProtocolScheme,
  parseProtocolUrl: mockParseProtocolUrl,
}));

// Mock isDev
vi.mock('@/const/env', () => ({
  isDev: false,
}));

describe('ProtocolManager', () => {
  let manager: ProtocolManager;
  let mockAppCore: AppCore;
  let mockShowMainWindow: ReturnType<typeof vi.fn>;
  let mockHandleProtocolRequest: ReturnType<typeof vi.fn>;

  // Store event handlers
  let openUrlHandler: ((event: any, url: string) => void) | undefined;
  let openFileHandler: ((event: any, filePath: string) => void) | undefined;
  let secondInstanceHandler: ((event: any, commandLine: string[]) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset electron app mock
    mockApp.isDefaultProtocolClient.mockReturnValue(true);
    mockApp.setAsDefaultProtocolClient.mockReturnValue(true);
    mockApp.isReady.mockReturnValue(true);

    // Capture event handlers
    openUrlHandler = undefined;
    openFileHandler = undefined;
    secondInstanceHandler = undefined;
    mockApp.on.mockImplementation((event: string, handler: any) => {
      if (event === 'open-url') {
        openUrlHandler = handler;
      } else if (event === 'open-file') {
        openFileHandler = handler;
      } else if (event === 'second-instance') {
        secondInstanceHandler = handler;
      }
      return mockApp;
    });

    // Reset protocol utils mock
    mockGetProtocolScheme.mockReturnValue('lobehub');
    mockParseProtocolUrl.mockReturnValue({
      action: 'install',
      params: { url: 'https://example.com' },
      urlType: 'plugin',
    });

    // Create mock App core
    mockShowMainWindow = vi.fn();
    mockHandleProtocolRequest = vi.fn().mockResolvedValue(true);

    mockAppCore = {
      browserManager: {
        showMainWindow: mockShowMainWindow,
      },
      handleProtocolRequest: mockHandleProtocolRequest,
    } as unknown as AppCore;

    manager = new ProtocolManager(mockAppCore);
  });

  it('queues deep links while the startup update window is blocking entry', async () => {
    mockAppCore.startupUpdatePending = true;
    manager.initialize();
    // The runner's own argv is not part of what this test asserts.
    manager['pendingTargets'] = [];
    openUrlHandler!(
      { preventDefault: vi.fn() },
      'lobehub://plugin/install?url=https://example.com',
    );
    expect(mockShowMainWindow).not.toHaveBeenCalled();
    expect(mockHandleProtocolRequest).not.toHaveBeenCalled();
    mockAppCore.startupUpdatePending = false;
    await manager.processPendingTargets();
    expect(mockHandleProtocolRequest).toHaveBeenCalledOnce();
  });

  describe('constructor', () => {
    it('should initialize with protocol scheme from getProtocolScheme', () => {
      expect(getProtocolScheme).toHaveBeenCalled();
      expect(manager.getScheme()).toBe('lobehub');
    });
  });

  describe('initialize', () => {
    it('should register protocol handlers', () => {
      manager.initialize();

      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('lobehub');
    });

    it('should set up event listeners', () => {
      manager.initialize();

      expect(app.on).toHaveBeenCalledWith('open-url', expect.any(Function));
      expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    });
  });

  describe('protocol registration', () => {
    it('should use explicit parameters in development mode', async () => {
      vi.doMock('@/const/env', () => ({ isDev: true }));
      vi.resetModules();

      const { ProtocolManager: DevProtocolManager } = await import('../ProtocolManager');
      const devManager = new DevProtocolManager(mockAppCore);
      devManager.initialize();

      // In dev mode, should be called with additional arguments
      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith(
        'lobehub',
        expect.any(String),
        expect.any(Array),
      );
    });

    it('should verify registration status after registering', () => {
      manager.initialize();

      expect(app.isDefaultProtocolClient).toHaveBeenCalledWith('lobehub');
    });
  });

  describe('parseLaunchTarget', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should extract protocol URL from command line arguments', () => {
      // Access private method through prototype
      const result = manager['parseLaunchTarget']([
        '/path/to/app',
        'lobehub://plugin/install?url=https://example.com',
      ]);

      expect(result).toEqual({
        kind: 'url',
        url: 'lobehub://plugin/install?url=https://example.com',
      });
    });

    it('should return null when no target found', () => {
      const result = manager['parseLaunchTarget'](['/path/to/app', '--some-flag']);

      expect(result).toBeNull();
    });

    it('should return first matching URL when multiple exist', () => {
      const result = manager['parseLaunchTarget']([
        '/path/to/app',
        'lobehub://first/action',
        'lobehub://second/action',
      ]);

      expect(result).toEqual({ kind: 'url', url: 'lobehub://first/action' });
    });

    it('should read a directory argument instead of dropping it', () => {
      // Regression: only `scheme://` URLs were scanned, so `LobeHub .` started
      // a window that knew nothing about the directory it was launched from.
      const result = manager['parseLaunchTarget'](['/path/to/app', process.cwd()]);

      expect(result).toMatchObject({ kind: 'path', newWindow: false, path: process.cwd() });
    });

    it('should carry --new-window with a directory target', () => {
      const result = manager['parseLaunchTarget'](['/path/to/app', '--new-window', process.cwd()]);

      expect(result).toMatchObject({ kind: 'path', newWindow: true });
    });
  });

  describe('open-file event', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should open a directory dropped on the app', async () => {
      expect(openFileHandler).toBeDefined();

      const mockEvent = { preventDefault: vi.fn() };
      openFileHandler!(mockEvent, process.cwd());

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(mockHandleProtocolRequest).toHaveBeenCalledWith('open', 'path', {
          newWindow: false,
          path: process.cwd(),
        });
      });
    });

    it('should ignore a dropped file that is not a directory', () => {
      const mockEvent = { preventDefault: vi.fn() };
      openFileHandler!(mockEvent, '/definitely/not/a/real/path/file.txt');

      expect(mockHandleProtocolRequest).not.toHaveBeenCalled();
    });
  });

  describe('handleLaunchTarget', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should store target when app is not ready', () => {
      mockApp.isReady.mockReturnValue(false);

      manager['handleLaunchTarget']({ kind: 'url', url: 'lobehub://plugin/install' });

      expect(manager['pendingTargets']).toEqual([{ kind: 'url', url: 'lobehub://plugin/install' }]);
      expect(mockShowMainWindow).not.toHaveBeenCalled();
    });

    it('should process URL immediately when app is ready', async () => {
      mockApp.isReady.mockReturnValue(true);

      manager['handleLaunchTarget']({ kind: 'url', url: 'lobehub://plugin/install' });

      // Allow async processing
      await vi.waitFor(() => {
        expect(mockShowMainWindow).toHaveBeenCalled();
      });
    });

    it('should dispatch a directory to the open:path handler', async () => {
      manager['handleLaunchTarget']({ kind: 'path', newWindow: true, path: process.cwd() });

      await vi.waitFor(() => {
        expect(mockHandleProtocolRequest).toHaveBeenCalledWith('open', 'path', {
          newWindow: true,
          path: process.cwd(),
        });
      });
      expect(mockShowMainWindow).toHaveBeenCalled();
    });

    it('should ignore URLs with invalid protocol scheme', async () => {
      mockApp.isReady.mockReturnValue(true);
      vi.mocked(parseProtocolUrl).mockReturnValue(null);

      manager['handleLaunchTarget']({ kind: 'url', url: 'invalid://plugin/install' });

      await Promise.resolve(); // Allow any async work

      expect(mockHandleProtocolRequest).not.toHaveBeenCalled();
    });
  });

  describe('event listeners', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should handle open-url event', async () => {
      expect(openUrlHandler).toBeDefined();

      const mockEvent = { preventDefault: vi.fn() };
      openUrlHandler!(mockEvent, 'lobehub://plugin/install');

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(mockShowMainWindow).toHaveBeenCalled();
      });
    });

    it('should handle second-instance event with protocol URL', async () => {
      expect(secondInstanceHandler).toBeDefined();

      const mockEvent = {};
      secondInstanceHandler!(mockEvent, ['/path/to/app', 'lobehub://plugin/install']);

      await vi.waitFor(() => {
        expect(mockShowMainWindow).toHaveBeenCalled();
      });
    });

    it('should show main window even without protocol URL in second-instance', () => {
      expect(secondInstanceHandler).toBeDefined();

      const mockEvent = {};
      secondInstanceHandler!(mockEvent, ['/path/to/app', '--some-flag']);

      expect(mockShowMainWindow).toHaveBeenCalled();
    });
  });

  describe('processPendingTargets', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should process all pending targets', async () => {
      // Add pending targets
      manager['pendingTargets'] = [
        { kind: 'url', url: 'lobehub://action1' },
        { kind: 'url', url: 'lobehub://action2' },
      ];

      await manager.processPendingTargets();

      // Should have shown main window for each target
      expect(mockShowMainWindow).toHaveBeenCalledTimes(2);
    });

    it('should clear pending targets after processing', async () => {
      manager['pendingTargets'] = [{ kind: 'url', url: 'lobehub://action1' }];

      await manager.processPendingTargets();

      expect(manager['pendingTargets']).toHaveLength(0);
    });

    it('should skip when no pending targets', async () => {
      manager['pendingTargets'] = [];

      await manager.processPendingTargets();

      expect(mockShowMainWindow).not.toHaveBeenCalled();
    });
  });

  describe('isRegistered', () => {
    it('should return true when registered', () => {
      mockApp.isDefaultProtocolClient.mockReturnValue(true);

      expect(manager.isRegistered()).toBe(true);
    });

    it('should return false when not registered', () => {
      mockApp.isDefaultProtocolClient.mockReturnValue(false);

      expect(manager.isRegistered()).toBe(false);
    });
  });

  describe('processProtocolUrl', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should dispatch the parsed request to its handler', async () => {
      vi.mocked(parseProtocolUrl).mockReturnValue({
        action: 'install',
        originalUrl: 'lobehub://plugin/install?url=https://example.com',
        params: { url: 'https://example.com' },
        urlType: 'plugin',
      });

      await manager['processProtocolUrl']('lobehub://plugin/install');

      expect(mockHandleProtocolRequest).toHaveBeenCalledWith('plugin', 'install', {
        url: 'https://example.com',
      });
    });

    it('should warn and return when parseProtocolUrl returns null', async () => {
      vi.mocked(parseProtocolUrl).mockReturnValue(null);

      await manager['processProtocolUrl']('lobehub://invalid');

      expect(mockHandleProtocolRequest).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockHandleProtocolRequest.mockRejectedValue(new Error('Handler error'));

      // Should not throw
      await expect(
        manager['processProtocolUrl']('lobehub://plugin/install'),
      ).resolves.not.toThrow();
    });
  });
});
