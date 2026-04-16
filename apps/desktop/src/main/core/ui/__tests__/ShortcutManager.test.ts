import { DEFAULT_ELECTRON_DESKTOP_SHORTCUTS } from '@lobechat/const/desktopGlobalShortcuts';
import { globalShortcut } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '../../App';
import { ShortcutManager } from '../ShortcutManager';

// Mock electron
vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(),
  },
}));

// Mock Logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock desktop global shortcut defaults
vi.mock('@lobechat/const/desktopGlobalShortcuts', () => ({
  DEFAULT_ELECTRON_DESKTOP_SHORTCUTS: {
    showApp: '',
    openSettings: 'CommandOrControl+,',
  },
}));

describe('ShortcutManager', () => {
  let shortcutManager: ShortcutManager;
  let mockApp: App;
  let mockStoreManager: any;
  let mockShortcutMethodMap: Map<string, () => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mocks to their default behavior
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    vi.mocked(globalShortcut.unregister).mockReturnValue(undefined);
    vi.mocked(globalShortcut.unregisterAll).mockReturnValue(undefined);
    vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);

    // Mock store manager
    mockStoreManager = {
      get: vi.fn(),
      set: vi.fn(),
    };

    // Mock shortcut method map
    mockShortcutMethodMap = new Map();
    const showAppMethod = vi.fn();
    const openSettingsMethod = vi.fn();
    mockShortcutMethodMap.set('showApp', showAppMethod);
    mockShortcutMethodMap.set('openSettings', openSettingsMethod);

    // Mock App
    mockApp = {
      storeManager: mockStoreManager,
      shortcutMethodMap: mockShortcutMethodMap,
    } as unknown as App;

    shortcutManager = new ShortcutManager(mockApp);
  });

  describe('constructor', () => {
    it('should initialize shortcut manager with app', () => {
      expect(shortcutManager).toBeDefined();
      expect(shortcutManager['app']).toBe(mockApp);
    });

    it('should populate shortcuts map from app shortcut method map', () => {
      expect(shortcutManager['shortcuts'].size).toBe(2);
      expect(shortcutManager['shortcuts'].has('showApp')).toBe(true);
      expect(shortcutManager['shortcuts'].has('openSettings')).toBe(true);
    });
  });

  describe('convertAcceleratorFormat', () => {
    it('should convert mod to CommandOrControl', () => {
      const result = shortcutManager['convertAcceleratorFormat']('mod+e');
      expect(result).toBe('CommandOrControl+E');
    });

    it('should preserve other keys as is except single characters', () => {
      const result = shortcutManager['convertAcceleratorFormat']('ctrl+alt+f12');
      expect(result).toBe('ctrl+alt+f12');
    });

    it('should handle single character keys with uppercase', () => {
      const result = shortcutManager['convertAcceleratorFormat']('ctrl + a');
      expect(result).toBe('ctrl+A');
    });

    it('should handle complex combinations', () => {
      const result = shortcutManager['convertAcceleratorFormat']('mod+shift+delete');
      expect(result).toBe('CommandOrControl+shift+delete');
    });
  });

  describe('initialize', () => {
    it('should load shortcuts config and register shortcuts', () => {
      // Mock store to return empty config (will use defaults)
      mockStoreManager.get.mockReturnValue({});

      shortcutManager.initialize();

      expect(mockStoreManager.get).toHaveBeenCalledWith('shortcuts');
      expect(globalShortcut.unregisterAll).toHaveBeenCalled();
      expect(globalShortcut.register).not.toHaveBeenCalledWith('Control+E', expect.any(Function));
      expect(globalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+,',
        expect.any(Function),
      );
    });

    it('should handle stored config with filtering', () => {
      const storedConfig = {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+Shift+P',
        invalidKey: 'Ctrl+I', // Should be filtered out
      };
      mockStoreManager.get.mockReturnValue(storedConfig);

      shortcutManager.initialize();

      const config = shortcutManager.getShortcutsConfig();
      expect(config.showApp).toBe('Alt+E');
      expect(config.openSettings).toBe('Ctrl+Shift+P');
      expect(config.invalidKey).toBeUndefined();
    });
  });

  describe('getShortcutsConfig', () => {
    it('should return current shortcuts configuration', () => {
      mockStoreManager.get.mockReturnValue({});
      shortcutManager.initialize();

      const config = shortcutManager.getShortcutsConfig();
      expect(config).toEqual(DEFAULT_ELECTRON_DESKTOP_SHORTCUTS);
    });
  });

  describe('updateShortcutConfig', () => {
    beforeEach(() => {
      mockStoreManager.get.mockReturnValue({});
      shortcutManager.initialize();
    });

    it('should successfully update valid shortcut', () => {
      const result = shortcutManager.updateShortcutConfig('showApp', 'Alt+E');

      expect(result.success).toBe(true);
      expect(result.errorType).toBeUndefined();
      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'shortcuts',
        expect.objectContaining({
          showApp: 'Alt+E',
        }),
      );
    });

    it('should reject invalid shortcut ID', () => {
      const result = shortcutManager.updateShortcutConfig('invalidId', 'Alt+E');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('INVALID_ID');
    });

    it('should clear shortcut when accelerator is empty', () => {
      const result = shortcutManager.updateShortcutConfig('showApp', '');

      expect(result.success).toBe(true);
      expect(result.errorType).toBeUndefined();
      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'shortcuts',
        expect.objectContaining({
          showApp: '',
        }),
      );
    });

    it('should reject accelerator without modifier keys', () => {
      const result = shortcutManager.updateShortcutConfig('showApp', 'E');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('INVALID_FORMAT');
    });

    it('should reject accelerator without proper modifiers', () => {
      const result = shortcutManager.updateShortcutConfig('showApp', 'F1+E');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('NO_MODIFIER');
    });

    it('should detect conflicts with existing shortcuts', () => {
      // First set a shortcut
      shortcutManager.updateShortcutConfig('showApp', 'Alt+E');

      // Try to set the same accelerator for another shortcut
      const result = shortcutManager.updateShortcutConfig('openSettings', 'Alt+E');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('CONFLICT');
    });

    it('should detect system occupied shortcuts', () => {
      vi.mocked(globalShortcut.register).mockReturnValue(false);

      const result = shortcutManager.updateShortcutConfig('showApp', 'Ctrl+Alt+T');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('SYSTEM_OCCUPIED');
    });

    it('should handle registration test cleanup', () => {
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager.updateShortcutConfig('showApp', 'Ctrl+Alt+T');

      // Should unregister the test registration
      expect(globalShortcut.unregister).toHaveBeenCalledWith('Ctrl+Alt+T');
    });

    it('should handle conversion from react-hotkey format', () => {
      const result = shortcutManager.updateShortcutConfig('showApp', 'mod+shift+e');

      expect(result.success).toBe(true);
      const config = shortcutManager.getShortcutsConfig();
      expect(config.showApp).toBe('CommandOrControl+shift+E');
    });

    it('should handle errors gracefully', () => {
      // Mock globalShortcut.register to throw an error during testing
      vi.mocked(globalShortcut.register).mockImplementation(() => {
        throw new Error('Register error');
      });

      const result = shortcutManager.updateShortcutConfig('showApp', 'Alt+E');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('UNKNOWN');
    });
  });

  describe('registerShortcut', () => {
    it('should register new shortcut successfully', () => {
      const callback = vi.fn();
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      const result = shortcutManager.registerShortcut('Ctrl+T', callback);

      expect(result).toBe(true);
      expect(globalShortcut.register).toHaveBeenCalledWith('Ctrl+T', callback);
      expect(shortcutManager['shortcuts'].has('Ctrl+T')).toBe(true);
    });

    it('should unregister existing shortcut before registering new one', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // First registration
      shortcutManager['shortcuts'].set('Ctrl+T', callback1);
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager.registerShortcut('Ctrl+T', callback2);

      expect(globalShortcut.unregister).toHaveBeenCalledWith('Ctrl+T');
      expect(globalShortcut.register).toHaveBeenCalledWith('Ctrl+T', callback2);
    });

    it('should handle registration failure', () => {
      const callback = vi.fn();
      vi.mocked(globalShortcut.register).mockReturnValue(false);

      const result = shortcutManager.registerShortcut('Ctrl+T', callback);

      expect(result).toBe(false);
      expect(shortcutManager['shortcuts'].has('Ctrl+T')).toBe(false);
    });

    it('should handle registration errors', () => {
      const callback = vi.fn();
      vi.mocked(globalShortcut.register).mockImplementation(() => {
        throw new Error('Registration error');
      });

      const result = shortcutManager.registerShortcut('Ctrl+T', callback);

      expect(result).toBe(false);
    });
  });

  describe('unregisterShortcut', () => {
    it('should unregister shortcut successfully', () => {
      const callback = vi.fn();
      shortcutManager['shortcuts'].set('Ctrl+T', callback);

      shortcutManager.unregisterShortcut('Ctrl+T');

      expect(globalShortcut.unregister).toHaveBeenCalledWith('Ctrl+T');
      expect(shortcutManager['shortcuts'].has('Ctrl+T')).toBe(false);
    });

    it('should handle unregistration errors', () => {
      vi.mocked(globalShortcut.unregister).mockImplementation(() => {
        throw new Error('Unregister error');
      });

      // Should not throw
      expect(() => shortcutManager.unregisterShortcut('Ctrl+T')).not.toThrow();
    });
  });

  describe('isRegistered', () => {
    it('should check if shortcut is registered', () => {
      vi.mocked(globalShortcut.isRegistered).mockReturnValue(true);

      const result = shortcutManager.isRegistered('Ctrl+T');

      expect(result).toBe(true);
      expect(globalShortcut.isRegistered).toHaveBeenCalledWith('Ctrl+T');
    });
  });

  describe('unregisterAll', () => {
    it('should unregister all shortcuts', () => {
      shortcutManager.unregisterAll();

      expect(globalShortcut.unregisterAll).toHaveBeenCalled();
    });
  });

  describe('loadShortcutsConfig', () => {
    it('should use defaults when no config exists', () => {
      mockStoreManager.get.mockReturnValue(null);

      shortcutManager['loadShortcutsConfig']();

      expect(shortcutManager['shortcutsConfig']).toEqual(DEFAULT_ELECTRON_DESKTOP_SHORTCUTS);
      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'shortcuts',
        DEFAULT_ELECTRON_DESKTOP_SHORTCUTS,
      );
    });

    it('should use defaults when config is empty', () => {
      mockStoreManager.get.mockReturnValue({});

      shortcutManager['loadShortcutsConfig']();

      expect(shortcutManager['shortcutsConfig']).toEqual(DEFAULT_ELECTRON_DESKTOP_SHORTCUTS);
    });

    it('should filter invalid keys from stored config', () => {
      const storedConfig = {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+P',
        invalidKey1: 'Ctrl+I',
        invalidKey2: 'Ctrl+J',
      };
      mockStoreManager.get.mockReturnValue(storedConfig);

      shortcutManager['loadShortcutsConfig']();

      const config = shortcutManager['shortcutsConfig'];
      expect(config.showApp).toBe('Alt+E');
      expect(config.openSettings).toBe('Ctrl+P');
      expect(config.invalidKey1).toBeUndefined();
      expect(config.invalidKey2).toBeUndefined();

      // Should save filtered config
      expect(mockStoreManager.set).toHaveBeenCalledWith('shortcuts', config);
    });

    it('should add missing default shortcuts', () => {
      const incompleteConfig = {
        showApp: 'Alt+E',
        // Missing openSettings
      };
      mockStoreManager.get.mockReturnValue(incompleteConfig);

      shortcutManager['loadShortcutsConfig']();

      const config = shortcutManager['shortcutsConfig'];
      expect(config.showApp).toBe('Alt+E');
      expect(config.openSettings).toBe('CommandOrControl+,'); // Default value
    });

    it('should not save config if no invalid keys were found', () => {
      const validConfig = {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+P',
      };
      mockStoreManager.get.mockReturnValue(validConfig);

      shortcutManager['loadShortcutsConfig']();

      // Should not call set since no changes were made
      expect(mockStoreManager.set).not.toHaveBeenCalled();
    });

    it('should handle store errors gracefully', () => {
      mockStoreManager.get.mockImplementation(() => {
        throw new Error('Store error');
      });

      shortcutManager['loadShortcutsConfig']();

      expect(shortcutManager['shortcutsConfig']).toEqual(DEFAULT_ELECTRON_DESKTOP_SHORTCUTS);
      expect(mockStoreManager.set).toHaveBeenCalledWith(
        'shortcuts',
        DEFAULT_ELECTRON_DESKTOP_SHORTCUTS,
      );
    });
  });

  describe('saveShortcutsConfig', () => {
    it('should save shortcuts config to store', () => {
      shortcutManager['shortcutsConfig'] = { showApp: 'Alt+E', openSettings: 'Ctrl+P' };

      shortcutManager['saveShortcutsConfig']();

      expect(mockStoreManager.set).toHaveBeenCalledWith('shortcuts', {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+P',
      });
    });

    it('should handle save errors gracefully', () => {
      mockStoreManager.set.mockImplementation(() => {
        throw new Error('Save error');
      });

      // Should not throw
      expect(() => shortcutManager['saveShortcutsConfig']()).not.toThrow();
    });
  });

  describe('registerConfiguredShortcuts', () => {
    beforeEach(() => {
      shortcutManager['shortcutsConfig'] = {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+P',
      };
    });

    it('should register all configured shortcuts', () => {
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager['registerConfiguredShortcuts']();

      expect(globalShortcut.unregisterAll).toHaveBeenCalled();
      expect(globalShortcut.register).toHaveBeenCalledWith('Alt+E', expect.any(Function));
      expect(globalShortcut.register).toHaveBeenCalledWith('Ctrl+P', expect.any(Function));
    });

    it('should skip shortcuts not defined in default electron desktop shortcuts', () => {
      shortcutManager['shortcutsConfig'] = {
        showApp: 'Alt+E',
        invalidKey: 'Ctrl+I',
      };

      shortcutManager['registerConfiguredShortcuts']();

      expect(globalShortcut.register).toHaveBeenCalledWith('Alt+E', expect.any(Function));
      expect(globalShortcut.register).not.toHaveBeenCalledWith('Ctrl+I', expect.any(Function));
    });

    it('should skip shortcuts with empty accelerator', () => {
      shortcutManager['shortcutsConfig'] = {
        showApp: '',
        openSettings: 'Ctrl+P',
      };

      shortcutManager['registerConfiguredShortcuts']();

      expect(globalShortcut.register).not.toHaveBeenCalledWith('', expect.any(Function));
      expect(globalShortcut.register).toHaveBeenCalledWith('Ctrl+P', expect.any(Function));
    });

    it('should skip shortcuts without corresponding methods', () => {
      // Remove method from map
      mockShortcutMethodMap.delete('openSettings');
      shortcutManager = new ShortcutManager(mockApp);
      shortcutManager['shortcutsConfig'] = {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+P',
      };

      shortcutManager['registerConfiguredShortcuts']();

      expect(globalShortcut.register).toHaveBeenCalledWith('Alt+E', expect.any(Function));
      expect(globalShortcut.register).not.toHaveBeenCalledWith('Ctrl+P', expect.any(Function));
    });
  });

  describe('integration tests', () => {
    it('should complete full initialization flow', () => {
      const storedConfig = {
        showApp: 'Alt+E',
        openSettings: 'Ctrl+Shift+P',
        invalidKey: 'Ctrl+I',
      };
      mockStoreManager.get.mockReturnValue(storedConfig);
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager.initialize();

      // Should filter config and register valid shortcuts
      const config = shortcutManager.getShortcutsConfig();
      expect(config.showApp).toBe('Alt+E');
      expect(config.openSettings).toBe('Ctrl+Shift+P');
      expect(config.invalidKey).toBeUndefined();

      expect(globalShortcut.register).toHaveBeenCalledTimes(2);
      expect(mockStoreManager.set).toHaveBeenCalledWith('shortcuts', config);
    });

    it('should handle complete update workflow', () => {
      mockStoreManager.get.mockReturnValue({});
      shortcutManager.initialize();

      // Update a shortcut
      const result = shortcutManager.updateShortcutConfig('showApp', 'mod+alt+e');

      expect(result.success).toBe(true);

      // Should convert format and register
      const config = shortcutManager.getShortcutsConfig();
      expect(config.showApp).toBe('CommandOrControl+alt+E');

      // Should have saved and re-registered shortcuts
      expect(mockStoreManager.set).toHaveBeenCalled();
      expect(globalShortcut.unregisterAll).toHaveBeenCalled();
      expect(globalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+alt+E',
        expect.any(Function),
      );
    });
  });
});
