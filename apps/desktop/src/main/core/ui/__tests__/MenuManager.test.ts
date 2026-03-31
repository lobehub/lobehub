import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '../../App';
import { MenuManager } from '../MenuManager';

// Mock electron modules
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
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

// Mock menu platform implementation
const mockBuildAndSetAppMenu = vi.fn();
const mockBuildContextMenu = vi.fn();
const mockBuildTrayMenu = vi.fn();
const mockRefresh = vi.fn();

vi.mock('@/menus', () => ({
  createMenuImpl: vi.fn(() => ({
    buildAndSetAppMenu: mockBuildAndSetAppMenu,
    buildContextMenu: mockBuildContextMenu,
    buildTrayMenu: mockBuildTrayMenu,
    refresh: mockRefresh,
  })),
}));

describe('MenuManager', () => {
  let menuManager: MenuManager;
  let mockApp: App;
  let mockMenu: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Menu instance
    mockMenu = {
      popup: vi.fn(),
      append: vi.fn(),
      insert: vi.fn(),
    };

    // Mock App
    mockApp = {} as unknown as App;

    // Setup mock returns
    mockBuildContextMenu.mockReturnValue(mockMenu);
    mockBuildTrayMenu.mockReturnValue(mockMenu);

    menuManager = new MenuManager(mockApp);
  });

  describe('constructor', () => {
    it('should initialize MenuManager with app instance', () => {
      expect(menuManager.app).toBe(mockApp);
    });

    it('should create platform implementation', async () => {
      const { createMenuImpl } = await import('@/menus');
      expect(createMenuImpl).toHaveBeenCalledWith(mockApp);
    });
  });

  describe('initialize', () => {
    it('should initialize application menu without options', () => {
      menuManager.initialize();

      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith(undefined);
    });

    it('should initialize application menu with options', () => {
      const options = { showDevItems: true };

      menuManager.initialize(options);

      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith(options);
    });

    it('should call buildAndSetAppMenu on platform implementation', () => {
      menuManager.initialize();

      expect(mockBuildAndSetAppMenu).toHaveBeenCalled();
    });
  });

  describe('showContextMenu', () => {
    it('should build and show context menu', () => {
      const type = 'text-input';
      const data = { text: 'sample' };

      const result = menuManager.showContextMenu(type, data);

      expect(mockBuildContextMenu).toHaveBeenCalledWith(type, data);
      expect(mockMenu.popup).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should build context menu without data', () => {
      const type = 'simple-menu';

      const result = menuManager.showContextMenu(type);

      expect(mockBuildContextMenu).toHaveBeenCalledWith(type, undefined);
      expect(mockMenu.popup).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should handle different menu types', () => {
      const types = ['edit', 'view', 'selection', 'link'];

      types.forEach((type) => {
        vi.clearAllMocks();
        menuManager.showContextMenu(type);
        expect(mockBuildContextMenu).toHaveBeenCalledWith(type, undefined);
        expect(mockMenu.popup).toHaveBeenCalled();
      });
    });
  });

  describe('buildTrayMenu', () => {
    it('should build tray menu', () => {
      const result = menuManager.buildTrayMenu();

      expect(mockBuildTrayMenu).toHaveBeenCalled();
      expect(result).toBe(mockMenu);
    });

    it('should return Menu instance', () => {
      const result = menuManager.buildTrayMenu();

      expect(result).toBeDefined();
      expect(result).toBe(mockMenu);
    });
  });

  describe('refreshMenus', () => {
    it('should refresh all menus without options', () => {
      const result = menuManager.refreshMenus();

      expect(mockRefresh).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true });
    });

    it('should refresh all menus with options', () => {
      const options = { showDevItems: false };

      const result = menuManager.refreshMenus(options);

      expect(mockRefresh).toHaveBeenCalledWith(options);
      expect(result).toEqual({ success: true });
    });

    it('should call refresh on platform implementation', () => {
      menuManager.refreshMenus();

      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  describe('rebuildAppMenu', () => {
    it('should rebuild application menu without options', () => {
      const result = menuManager.rebuildAppMenu();

      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true });
    });

    it('should rebuild application menu with options', () => {
      const options = { showDevItems: true };

      const result = menuManager.rebuildAppMenu(options);

      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith(options);
      expect(result).toEqual({ success: true });
    });

    it('should call buildAndSetAppMenu on platform implementation', () => {
      menuManager.rebuildAppMenu();

      expect(mockBuildAndSetAppMenu).toHaveBeenCalled();
    });
  });

  describe('integration tests', () => {
    it('should handle complete menu lifecycle', () => {
      // Initialize menus
      menuManager.initialize({ showDevItems: true });
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith({ showDevItems: true });

      // Show context menu
      menuManager.showContextMenu('edit');
      expect(mockBuildContextMenu).toHaveBeenCalledWith('edit', undefined);
      expect(mockMenu.popup).toHaveBeenCalled();

      // Build tray menu
      const trayMenu = menuManager.buildTrayMenu();
      expect(mockBuildTrayMenu).toHaveBeenCalled();
      expect(trayMenu).toBe(mockMenu);

      // Refresh menus
      menuManager.refreshMenus({ showDevItems: false });
      expect(mockRefresh).toHaveBeenCalledWith({ showDevItems: false });

      // Rebuild app menu
      menuManager.rebuildAppMenu({ showDevItems: true });
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith({ showDevItems: true });
    });

    it('should handle multiple context menu calls', () => {
      menuManager.showContextMenu('edit');
      menuManager.showContextMenu('view');
      menuManager.showContextMenu('selection');

      expect(mockBuildContextMenu).toHaveBeenCalledTimes(3);
      expect(mockMenu.popup).toHaveBeenCalledTimes(3);
    });

    it('should handle menu toggling workflow', () => {
      // Initialize with dev menu hidden
      menuManager.initialize({ showDevItems: false });
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith({ showDevItems: false });

      // Toggle dev menu on
      menuManager.rebuildAppMenu({ showDevItems: true });
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith({ showDevItems: true });

      // Toggle dev menu off
      menuManager.rebuildAppMenu({ showDevItems: false });
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith({ showDevItems: false });
    });
  });

  describe('error handling', () => {
    it('should handle errors from buildContextMenu gracefully', () => {
      mockBuildContextMenu.mockImplementation(() => {
        throw new Error('Failed to build context menu');
      });

      expect(() => menuManager.showContextMenu('edit')).toThrow('Failed to build context menu');
    });

    it('should handle errors from buildTrayMenu gracefully', () => {
      mockBuildTrayMenu.mockImplementation(() => {
        throw new Error('Failed to build tray menu');
      });

      expect(() => menuManager.buildTrayMenu()).toThrow('Failed to build tray menu');
    });

    it('should handle errors from refresh gracefully', () => {
      mockRefresh.mockImplementation(() => {
        throw new Error('Failed to refresh menus');
      });

      expect(() => menuManager.refreshMenus()).toThrow('Failed to refresh menus');
    });

    it('should handle errors from buildAndSetAppMenu gracefully', () => {
      mockBuildAndSetAppMenu.mockImplementation(() => {
        throw new Error('Failed to build app menu');
      });

      expect(() => menuManager.initialize()).toThrow('Failed to build app menu');
    });
  });

  describe('platform implementation delegation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Reset mocks to default behavior
      mockBuildAndSetAppMenu.mockImplementation(() => {});
      mockBuildContextMenu.mockReturnValue(mockMenu);
      mockBuildTrayMenu.mockReturnValue(mockMenu);
      mockRefresh.mockImplementation(() => {});
    });

    it('should delegate all menu operations to platform implementation', () => {
      const options = { showDevItems: true };

      // Test each method delegates to platform impl
      menuManager.initialize(options);
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith(options);

      menuManager.showContextMenu('edit', { test: 'data' });
      expect(mockBuildContextMenu).toHaveBeenCalledWith('edit', { test: 'data' });

      menuManager.buildTrayMenu();
      expect(mockBuildTrayMenu).toHaveBeenCalled();

      menuManager.refreshMenus(options);
      expect(mockRefresh).toHaveBeenCalledWith(options);

      menuManager.rebuildAppMenu(options);
      expect(mockBuildAndSetAppMenu).toHaveBeenCalledWith(options);
    });

    it('should maintain consistent interface across all operations', () => {
      // All modification operations should return success response
      expect(menuManager.showContextMenu('edit')).toEqual({ success: true });
      expect(menuManager.refreshMenus()).toEqual({ success: true });
      expect(menuManager.rebuildAppMenu()).toEqual({ success: true });

      // buildTrayMenu should return Menu instance
      const trayMenu = menuManager.buildTrayMenu();
      expect(trayMenu).toBe(mockMenu);
    });
  });
});
