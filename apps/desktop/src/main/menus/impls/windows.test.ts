import { Menu, app, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import { WindowsMenu } from './windows';

// Mock Electron modules
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
  app: {
    getName: vi.fn(() => 'LobeChat'),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// Mock isDev
vi.mock('@/const/env', () => ({
  isDev: false,
}));

// Mock App instance
const createMockApp = () => {
  const mockT = vi.fn((key: string, params?: any) => {
    const translations: Record<string, string> = {
      'file.title': 'File',
      'file.preferences': 'Settings',
      'file.quit': 'Exit',
      'common.checkUpdates': 'Check for Updates',
      'window.close': 'Close',
      'window.minimize': 'Minimize',
      'window.title': 'Window',
      'edit.title': 'Edit',
      'edit.undo': 'Undo',
      'edit.redo': 'Redo',
      'edit.cut': 'Cut',
      'edit.copy': 'Copy',
      'edit.paste': 'Paste',
      'edit.selectAll': 'Select All',
      'edit.delete': 'Delete',
      'view.title': 'View',
      'view.resetZoom': 'Reset Zoom',
      'view.zoomIn': 'Zoom In',
      'view.zoomOut': 'Zoom Out',
      'view.toggleFullscreen': 'Full Screen',
      'help.title': 'Help',
      'help.visitWebsite': 'Visit Website',
      'help.githubRepo': 'GitHub Repository',
      'dev.title': 'Developer',
      'dev.reload': 'Reload',
      'dev.forceReload': 'Force Reload',
      'dev.devTools': 'Developer Tools',
      'dev.devPanel': 'Dev Panel',
      'tray.open': `Open ${params?.appName || 'App'}`,
      'tray.quit': 'Quit',
    };
    return translations[key] || key;
  });

  return {
    i18n: {
      ns: vi.fn(() => mockT),
    },
    browserManager: {
      showMainWindow: vi.fn(),
      retrieveByIdentifier: vi.fn(() => ({
        show: vi.fn(),
      })),
    },
    updaterManager: {
      checkForUpdates: vi.fn(),
    },
  } as unknown as App;
};

describe('WindowsMenu', () => {
  let windowsMenu: WindowsMenu;
  let mockApp: App;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = createMockApp();
    windowsMenu = new WindowsMenu(mockApp);
  });

  describe('buildAndSetAppMenu', () => {
    it('should build and set application menu', () => {
      const menu = windowsMenu.buildAndSetAppMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should include developer menu when showDevItems is true', () => {
      windowsMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      expect(devMenu).toBeDefined();
    });

    it('should not include developer menu when showDevItems is false', () => {
      windowsMenu.buildAndSetAppMenu({ showDevItems: false });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      expect(devMenu).toBeUndefined();
    });

    it('should create menu with File, Edit, View, Window, Help', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const menuLabels = template.map((item: any) => item.label);

      expect(menuLabels).toContain('File');
      expect(menuLabels).toContain('Edit');
      expect(menuLabels).toContain('View');
      expect(menuLabels).toContain('Window');
      expect(menuLabels).toContain('Help');
    });
  });

  describe('buildContextMenu', () => {
    it('should build chat context menu', () => {
      const menu = windowsMenu.buildContextMenu('chat');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should build editor context menu', () => {
      const menu = windowsMenu.buildContextMenu('editor');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should build default context menu for unknown type', () => {
      const menu = windowsMenu.buildContextMenu('unknown');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should pass data to context menu', () => {
      const data = { selectionText: 'selected text', x: 100, y: 200 };
      windowsMenu.buildContextMenu('editor', data);

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
    });
  });

  describe('buildTrayMenu', () => {
    it('should build tray menu', () => {
      const menu = windowsMenu.buildTrayMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should include open and quit items in tray menu', () => {
      windowsMenu.buildTrayMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      expect(template.length).toBeGreaterThan(0);
      expect(template.some((item: any) => item.label?.includes('Open'))).toBe(true);
      expect(template.some((item: any) => item.label === 'Quit')).toBe(true);
    });
  });

  describe('refresh', () => {
    it('should rebuild application menu', () => {
      windowsMenu.refresh();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalled();
    });

    it('should pass options to rebuild', () => {
      windowsMenu.refresh({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      expect(devMenu).toBeDefined();
    });
  });

  describe('menu item click handlers', () => {
    it('should handle preferences click', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const preferencesItem = fileMenu.submenu.find((item: any) => item.label === 'Settings');

      expect(preferencesItem).toBeDefined();
      preferencesItem.click();
      expect(mockApp.browserManager.retrieveByIdentifier).toHaveBeenCalledWith('settings');
    });

    it('should handle check for updates click', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const checkUpdatesItem = fileMenu.submenu.find(
        (item: any) => item.label === 'Check for Updates',
      );

      expect(checkUpdatesItem).toBeDefined();
      checkUpdatesItem.click();
      expect(mockApp.updaterManager.checkForUpdates).toHaveBeenCalledWith({ manual: true });
    });

    it('should handle visit website click', async () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const visitWebsiteItem = helpMenu.submenu.find((item: any) => item.label === 'Visit Website');

      expect(visitWebsiteItem).toBeDefined();
      await visitWebsiteItem.click();
      expect(shell.openExternal).toHaveBeenCalledWith('https://lobehub.com');
    });

    it('should handle github repo click', async () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const githubItem = helpMenu.submenu.find((item: any) => item.label === 'GitHub Repository');

      expect(githubItem).toBeDefined();
      await githubItem.click();
      expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/lobehub/lobe-chat');
    });

    it('should handle tray open click', () => {
      windowsMenu.buildTrayMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const openItem = template.find((item: any) => item.label?.includes('Open'));

      expect(openItem).toBeDefined();
      openItem.click();
      expect(mockApp.browserManager.showMainWindow).toHaveBeenCalled();
    });
  });

  describe('menu accelerators', () => {
    it('should use role for standard edit shortcuts (accelerators handled by Electron)', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const editMenu = template.find((item: any) => item.label === 'Edit');
      const copyItem = editMenu.submenu.find((item: any) => item.label === 'Copy');

      expect(copyItem.role).toBe('copy');
    });

    it('should set correct accelerator for close', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const closeItem = fileMenu.submenu.find((item: any) => item.label === 'Close');

      expect(closeItem.accelerator).toBe('Alt+F4');
    });

    it('should use role for minimize (accelerator handled by Electron)', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const minimizeItem = fileMenu.submenu.find((item: any) => item.label === 'Minimize');

      expect(minimizeItem.role).toBe('minimize');
    });

    it('should use role for fullscreen (accelerator handled by Electron)', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const viewMenu = template.find((item: any) => item.label === 'View');
      const fullscreenItem = viewMenu.submenu.find((item: any) => item.label === 'Full Screen');

      expect(fullscreenItem.role).toBe('togglefullscreen');
    });
  });

  describe('developer menu items', () => {
    it('should include dev tools shortcuts in developer menu', () => {
      windowsMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');

      expect(devMenu).toBeDefined();
      expect(devMenu.submenu.length).toBeGreaterThan(0);
    });

    it('should handle dev panel click', () => {
      windowsMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      const devPanelItem = devMenu.submenu.find((item: any) => item.label === 'Dev Panel');

      expect(devPanelItem).toBeDefined();
      devPanelItem.click();
      expect(mockApp.browserManager.retrieveByIdentifier).toHaveBeenCalledWith('devtools');
    });

    it('should use role for developer tools (accelerator handled by Electron)', () => {
      windowsMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      const devToolsItem = devMenu.submenu.find((item: any) => item.label === 'Developer Tools');

      expect(devToolsItem.role).toBe('toggleDevTools');
    });
  });

  describe('context menu templates', () => {
    it('should include copy and paste in chat context menu', () => {
      windowsMenu.buildContextMenu('chat');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const copyItem = template.find((item: any) => item.role === 'copy');
      const pasteItem = template.find((item: any) => item.role === 'paste');

      expect(copyItem).toBeDefined();
      expect(pasteItem).toBeDefined();
    });

    it('should use role for copy in context menus (accelerator handled by Electron)', () => {
      windowsMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const copyItem = template.find((item: any) => item.role === 'copy');

      expect(copyItem).toBeDefined();
      expect(copyItem.role).toBe('copy');
    });

    it('should include cut in editor context menu', () => {
      windowsMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const cutItem = template.find((item: any) => item.role === 'cut');

      expect(cutItem).toBeDefined();
      expect(cutItem.role).toBe('cut');
    });

    it('should include delete in editor context menu', () => {
      windowsMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const deleteItem = template.find((item: any) => item.role === 'delete');

      expect(deleteItem).toBeDefined();
    });
  });

  describe('menu structure', () => {
    it('should have separators in menus', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const hasSeparator = fileMenu.submenu.some((item: any) => item.type === 'separator');

      expect(hasSeparator).toBe(true);
    });

    it('should have minimize and close in window menu', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const windowMenu = template.find((item: any) => item.label === 'Window');

      const minimizeItem = windowMenu.submenu.find((item: any) => item.role === 'minimize');
      const closeItem = windowMenu.submenu.find((item: any) => item.role === 'close');

      expect(minimizeItem).toBeDefined();
      expect(closeItem).toBeDefined();
    });

    it('should have zoom controls in view menu', () => {
      windowsMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const viewMenu = template.find((item: any) => item.label === 'View');

      const resetZoomItem = viewMenu.submenu.find((item: any) => item.role === 'resetZoom');
      const zoomInItem = viewMenu.submenu.find((item: any) => item.role === 'zoomIn');
      const zoomOutItem = viewMenu.submenu.find((item: any) => item.role === 'zoomOut');

      expect(resetZoomItem).toBeDefined();
      expect(zoomInItem).toBeDefined();
      expect(zoomOutItem).toBeDefined();
    });
  });

  describe('i18n integration', () => {
    it('should use i18n for all menu labels', () => {
      windowsMenu.buildAndSetAppMenu();

      expect(mockApp.i18n.ns).toHaveBeenCalledWith('menu');
    });

    it('should request translations multiple times for tray menu', () => {
      windowsMenu.buildTrayMenu();

      expect(mockApp.i18n.ns).toHaveBeenCalled();
      expect(app.getName).toHaveBeenCalled();
    });
  });
});
