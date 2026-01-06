import { nativeTheme } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '../../App';
import { Tray } from '../Tray';
import { TrayManager } from '../TrayManager';

// Mock electron modules
vi.mock('electron', () => ({
  nativeTheme: {
    shouldUseDarkColorsForSystemIntegratedUI: false,
  },
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock environment constants
vi.mock('@/const/env', () => ({
  isMac: true,
}));

// Mock package.json
vi.mock('@/../../package.json', () => ({
  name: 'test-app',
}));

// Mock Tray class
vi.mock('../Tray', () => ({
  Tray: vi.fn(),
}));

describe('TrayManager', () => {
  let trayManager: TrayManager;
  let mockApp: App;
  let mockTray: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Tray instance
    mockTray = {
      identifier: 'main',
      broadcast: vi.fn(),
      destroy: vi.fn(),
      updateIcon: vi.fn(),
      updateTooltip: vi.fn(),
    };

    // Mock App
    mockApp = {} as unknown as App;

    // Mock Tray constructor
    vi.mocked(Tray).mockImplementation(() => mockTray);

    trayManager = new TrayManager(mockApp);
  });

  describe('constructor', () => {
    it('should initialize TrayManager with app instance', () => {
      expect(trayManager.app).toBe(mockApp);
      expect(trayManager.trays).toBeInstanceOf(Map);
      expect(trayManager.trays.size).toBe(0);
    });
  });

  describe('initializeTrays', () => {
    it('should initialize main tray', () => {
      trayManager.initializeTrays();

      expect(Tray).toHaveBeenCalled();
      expect(trayManager.trays.has('main')).toBe(true);
    });

    it('should call initializeMainTray', () => {
      const spy = vi.spyOn(trayManager, 'initializeMainTray');

      trayManager.initializeTrays();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('initializeMainTray', () => {
    it('should create main tray with dark icon on macOS when dark mode is enabled', () => {
      Object.defineProperty(nativeTheme, 'shouldUseDarkColorsForSystemIntegratedUI', {
        value: true,
        writable: true,
        configurable: true,
      });

      const result = trayManager.initializeMainTray();

      expect(Tray).toHaveBeenCalledWith(
        expect.objectContaining({
          iconPath: 'tray-dark.png',
          identifier: 'main',
          tooltip: 'test-app',
        }),
        mockApp,
      );
      expect(result).toBe(mockTray);
    });

    it('should create main tray with light icon on macOS when light mode is enabled', () => {
      Object.defineProperty(nativeTheme, 'shouldUseDarkColorsForSystemIntegratedUI', {
        value: false,
        writable: true,
        configurable: true,
      });

      trayManager.initializeMainTray();

      expect(Tray).toHaveBeenCalledWith(
        expect.objectContaining({
          iconPath: 'tray-light.png',
          identifier: 'main',
          tooltip: 'test-app',
        }),
        mockApp,
      );
    });

    it('should add created tray to trays map', () => {
      trayManager.initializeMainTray();

      expect(trayManager.trays.has('main')).toBe(true);
      expect(trayManager.trays.get('main')).toBe(mockTray);
    });

    it('should return existing tray if already initialized', () => {
      const firstTray = trayManager.initializeMainTray();
      vi.clearAllMocks();

      const secondTray = trayManager.initializeMainTray();

      expect(firstTray).toBe(secondTray);
      expect(Tray).not.toHaveBeenCalled();
    });
  });

  describe('getMainTray', () => {
    it('should return main tray when it exists', () => {
      trayManager.initializeMainTray();

      const result = trayManager.getMainTray();

      expect(result).toBe(mockTray);
    });

    it('should return undefined when main tray does not exist', () => {
      const result = trayManager.getMainTray();

      expect(result).toBeUndefined();
    });
  });

  describe('retrieveByIdentifier', () => {
    it('should return tray by identifier when it exists', () => {
      trayManager.initializeMainTray();

      const result = trayManager.retrieveByIdentifier('main');

      expect(result).toBe(mockTray);
    });

    it('should return undefined when tray with identifier does not exist', () => {
      const result = trayManager.retrieveByIdentifier('main');

      expect(result).toBeUndefined();
    });
  });

  describe('broadcastToAllTrays', () => {
    it('should broadcast event to all trays', () => {
      trayManager.initializeMainTray();

      const event = 'test-event' as any;
      const data = { test: 'data' };

      trayManager.broadcastToAllTrays(event, data);

      expect(mockTray.broadcast).toHaveBeenCalledWith(event, data);
    });

    it('should handle multiple trays', () => {
      // Create main tray
      trayManager.initializeMainTray();

      // Mock another tray
      const mockTray2 = {
        identifier: 'secondary',
        broadcast: vi.fn(),
        destroy: vi.fn(),
      };
      trayManager.trays.set('secondary' as any, mockTray2 as any);

      const event = 'test-event' as any;
      const data = { test: 'data' };

      trayManager.broadcastToAllTrays(event, data);

      expect(mockTray.broadcast).toHaveBeenCalledWith(event, data);
      expect(mockTray2.broadcast).toHaveBeenCalledWith(event, data);
    });

    it('should not throw when no trays exist', () => {
      const event = 'test-event' as any;
      const data = { test: 'data' };

      expect(() => trayManager.broadcastToAllTrays(event, data)).not.toThrow();
    });
  });

  describe('broadcastToTray', () => {
    it('should broadcast event to specific tray', () => {
      trayManager.initializeMainTray();

      const event = 'test-event' as any;
      const data = { test: 'data' };

      trayManager.broadcastToTray('main', event, data);

      expect(mockTray.broadcast).toHaveBeenCalledWith(event, data);
    });

    it('should not throw when tray does not exist', () => {
      const event = 'test-event' as any;
      const data = { test: 'data' };

      expect(() => trayManager.broadcastToTray('main', event, data)).not.toThrow();
    });

    it('should not call broadcast when tray does not exist', () => {
      const event = 'test-event' as any;
      const data = { test: 'data' };

      trayManager.broadcastToTray('main', event, data);

      expect(mockTray.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('destroyAll', () => {
    it('should destroy all trays', () => {
      trayManager.initializeMainTray();

      trayManager.destroyAll();

      expect(mockTray.destroy).toHaveBeenCalled();
      expect(trayManager.trays.size).toBe(0);
    });

    it('should destroy multiple trays', () => {
      // Create main tray
      trayManager.initializeMainTray();

      // Mock another tray
      const mockTray2 = {
        identifier: 'secondary',
        broadcast: vi.fn(),
        destroy: vi.fn(),
      };
      trayManager.trays.set('secondary' as any, mockTray2 as any);

      trayManager.destroyAll();

      expect(mockTray.destroy).toHaveBeenCalled();
      expect(mockTray2.destroy).toHaveBeenCalled();
      expect(trayManager.trays.size).toBe(0);
    });

    it('should clear trays map after destroying', () => {
      trayManager.initializeMainTray();

      trayManager.destroyAll();

      expect(trayManager.trays.size).toBe(0);
    });

    it('should not throw when no trays exist', () => {
      expect(() => trayManager.destroyAll()).not.toThrow();
    });
  });

  describe('retrieveOrInitialize (private method)', () => {
    it('should create new tray when it does not exist', () => {
      const options = {
        iconPath: 'test.png',
        identifier: 'main',
        tooltip: 'Test',
      };

      const result = trayManager['retrieveOrInitialize'](options);

      expect(Tray).toHaveBeenCalledWith(options, mockApp);
      expect(result).toBe(mockTray);
      expect(trayManager.trays.has('main')).toBe(true);
    });

    it('should return existing tray when it already exists', () => {
      const options = {
        iconPath: 'test.png',
        identifier: 'main',
        tooltip: 'Test',
      };

      const firstResult = trayManager['retrieveOrInitialize'](options);
      vi.clearAllMocks();

      const secondResult = trayManager['retrieveOrInitialize'](options);

      expect(firstResult).toBe(secondResult);
      expect(Tray).not.toHaveBeenCalled();
    });
  });

  describe('integration tests', () => {
    it('should handle complete tray manager lifecycle', () => {
      // Initialize trays
      trayManager.initializeTrays();
      expect(trayManager.trays.size).toBe(1);

      // Get main tray
      const mainTray = trayManager.getMainTray();
      expect(mainTray).toBeDefined();

      // Broadcast to all
      trayManager.broadcastToAllTrays('test-event' as any, { data: 'test' });
      expect(mockTray.broadcast).toHaveBeenCalled();

      // Broadcast to specific tray
      vi.clearAllMocks();
      trayManager.broadcastToTray('main', 'test-event' as any, { data: 'test' });
      expect(mockTray.broadcast).toHaveBeenCalled();

      // Destroy all
      trayManager.destroyAll();
      expect(mockTray.destroy).toHaveBeenCalled();
      expect(trayManager.trays.size).toBe(0);
    });

    it('should handle multiple initialization calls safely', () => {
      trayManager.initializeTrays();
      trayManager.initializeTrays();
      trayManager.initializeTrays();

      // Should only create one tray instance
      expect(Tray).toHaveBeenCalledTimes(1);
      expect(trayManager.trays.size).toBe(1);
    });
  });
});
