import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProtocolScheme, parseProtocolUrl } from '@/utils/protocol';

import type { App as AppCore } from '../../App';
import { ProtocolManager } from '../ProtocolManager';

// Use vi.hoisted to define mocks before hoisting
const { mockApp, mockGetProtocolScheme, mockLogger, mockParseProtocolUrl } = vi.hoisted(() => ({
  mockApp: {
    getPath: vi.fn().mockReturnValue('/mock/exe/path'),
    isDefaultProtocolClient: vi.fn().mockReturnValue(true),
    isReady: vi.fn().mockReturnValue(true),
    name: 'LobeHub',
    on: vi.fn(),
    setAsDefaultProtocolClient: vi.fn().mockReturnValue(true),
  },
  mockGetProtocolScheme: vi.fn().mockReturnValue('lobehub'),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  mockParseProtocolUrl: vi.fn(),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: mockApp,
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => mockLogger,
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
  let secondInstanceHandler: ((event: any, commandLine: string[]) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset electron app mock
    mockApp.isDefaultProtocolClient.mockReturnValue(true);
    mockApp.setAsDefaultProtocolClient.mockReturnValue(true);
    mockApp.isReady.mockReturnValue(true);

    // Capture event handlers
    openUrlHandler = undefined;
    secondInstanceHandler = undefined;
    mockApp.on.mockImplementation((event: string, handler: any) => {
      if (event === 'open-url') {
        openUrlHandler = handler;
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
    it('should use simple registration in production mode', () => {
      manager.initialize();

      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('lobehub');
    });

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

  describe('getProtocolUrlFromArgs', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should extract protocol URL from command line arguments', () => {
      // Access private method through prototype
      const result = manager['getProtocolUrlFromArgs']([
        '/path/to/app',
        'lobehub://plugin/install?url=https://example.com',
      ]);

      expect(result).toBe('lobehub://plugin/install?url=https://example.com');
    });

    it('should return null when no matching URL found', () => {
      const result = manager['getProtocolUrlFromArgs'](['/path/to/app', '--some-flag']);

      expect(result).toBeNull();
    });

    it('should return first matching URL when multiple exist', () => {
      const result = manager['getProtocolUrlFromArgs']([
        'lobehub://first/action',
        'lobehub://second/action',
      ]);

      expect(result).toBe('lobehub://first/action');
    });

    it('does not write protocol URL credentials to logs', () => {
      const secret = 'super-secret-api-key';
      const url = `lobehub://plugin/install?schema=${secret}`;

      expect(manager['getProtocolUrlFromArgs'](['/path/to/app', url])).toBe(url);
      expect(JSON.stringify(mockLogger.debug.mock.calls)).not.toContain(secret);
    });
  });

  describe('handleProtocolUrl', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should store URL when app is not ready', () => {
      mockApp.isReady.mockReturnValue(false);

      manager['handleProtocolUrl']('lobehub://plugin/install');

      expect(manager['pendingUrls']).toContain('lobehub://plugin/install');
      expect(mockShowMainWindow).not.toHaveBeenCalled();
    });

    it('should process URL immediately when app is ready', async () => {
      mockApp.isReady.mockReturnValue(true);

      manager['handleProtocolUrl']('lobehub://plugin/install');

      // Allow async processing
      await vi.waitFor(() => {
        expect(mockShowMainWindow).toHaveBeenCalled();
      });
    });

    it('should ignore URLs with invalid protocol scheme', async () => {
      mockApp.isReady.mockReturnValue(true);

      manager['handleProtocolUrl']('invalid://plugin/install');

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

  describe('processPendingUrls', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should process all pending URLs', async () => {
      // Add pending URLs
      manager['pendingUrls'] = ['lobehub://action1', 'lobehub://action2'];

      await manager.processPendingUrls();

      // Should have shown main window for each URL
      expect(mockShowMainWindow).toHaveBeenCalledTimes(2);
    });

    it('should clear pending URLs after processing', async () => {
      manager['pendingUrls'] = ['lobehub://action1'];

      await manager.processPendingUrls();

      expect(manager['pendingUrls']).toHaveLength(0);
    });

    it('should skip when no pending URLs', async () => {
      manager['pendingUrls'] = [];

      await manager.processPendingUrls();

      expect(mockShowMainWindow).not.toHaveBeenCalled();
    });
  });

  describe('getScheme', () => {
    it('should return the protocol scheme', () => {
      expect(manager.getScheme()).toBe('lobehub');
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

    it('should show main window and dispatch to handler', async () => {
      vi.mocked(parseProtocolUrl).mockReturnValue({
        action: 'install',
        originalUrl: 'lobehub://plugin/install?url=https://example.com',
        params: { url: 'https://example.com' },
        urlType: 'plugin',
      });

      await manager['processProtocolUrl']('lobehub://plugin/install');

      expect(mockShowMainWindow).toHaveBeenCalled();
      expect(mockHandleProtocolRequest).toHaveBeenCalledWith('plugin', 'install', {
        url: 'https://example.com',
      });
    });

    it('should warn and return when parseProtocolUrl returns null', async () => {
      vi.mocked(parseProtocolUrl).mockReturnValue(null);

      await manager['processProtocolUrl']('lobehub://invalid');

      expect(mockShowMainWindow).toHaveBeenCalled();
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
