import { Menu, app, dialog, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import { LinuxMenu } from './linux';

// Mock Electron modules
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
  app: {
    getName: vi.fn(() => 'LobeChat'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  shell: {
    openExternal: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
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
      'file.preferences': 'Preferences',
      'file.quit': 'Quit',
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
      'view.toggleFullscreen': 'Toggle Full Screen',
      'help.title': 'Help',
      'help.visitWebsite': 'Visit Website',
      'help.githubRepo': 'GitHub Repository',
      'help.about': 'About',
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

  const mockCommonT = vi.fn((key: string) => {
    const translations: Record<string, string> = {
      'actions.ok': 'OK',
    };
    return translations[key] || key;
  });

  const mockDialogT = vi.fn((key: string, params?: any) => {
    const translations: Record<string, string> = {
      'about.title': 'About',
      'about.message': `${params?.appName || 'App'} ${params?.appVersion || '1.0.0'}`,
      'about.detail': 'LobeChat Desktop Application',
    };
    return translations[key] || key;
  });

  return {
    i18n: {
      ns: vi.fn((namespace: string) => {
        if (namespace === 'common') return mockCommonT;
        if (namespace === 'dialog') return mockDialogT;
        return mockT;
      }),
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

describe('LinuxMenu', () => {
  let linuxMenu: LinuxMenu;
  let mockApp: App;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = createMockApp();
    linuxMenu = new LinuxMenu(mockApp);
  });

  describe('buildAndSetAppMenu', () => {
    it('should build and set application menu', () => {
      const menu = linuxMenu.buildAndSetAppMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should include developer menu when showDevItems is true', () => {
      linuxMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      expect(devMenu).toBeDefined();
    });

    it('should not include developer menu when showDevItems is false', () => {
      linuxMenu.buildAndSetAppMenu({ showDevItems: false });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      expect(devMenu).toBeUndefined();
    });

    it('should create menu with File, Edit, View, Window, Help', () => {
      linuxMenu.buildAndSetAppMenu();

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
      const menu = linuxMenu.buildContextMenu('chat');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should build editor context menu', () => {
      const menu = linuxMenu.buildContextMenu('editor');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should build default context menu for unknown type', () => {
      const menu = linuxMenu.buildContextMenu('unknown');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should pass data to context menu', () => {
      const data = { selectionText: 'test selection', x: 100, y: 200 };
      linuxMenu.buildContextMenu('chat', data);

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
    });
  });

  describe('buildTrayMenu', () => {
    it('should build tray menu', () => {
      const menu = linuxMenu.buildTrayMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should include open and quit items in tray menu', () => {
      linuxMenu.buildTrayMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      expect(template.length).toBeGreaterThan(0);
      expect(template.some((item: any) => item.label?.includes('Open'))).toBe(true);
      expect(template.some((item: any) => item.label === 'Quit')).toBe(true);
    });
  });

  describe('refresh', () => {
    it('should rebuild application menu', () => {
      linuxMenu.refresh();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalled();
    });

    it('should pass options to rebuild', () => {
      linuxMenu.refresh({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      expect(devMenu).toBeDefined();
    });
  });

  describe('menu item click handlers', () => {
    it('should handle preferences click', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const preferencesItem = fileMenu.submenu.find((item: any) => item.label === 'Preferences');

      expect(preferencesItem).toBeDefined();
      preferencesItem.click();
      expect(mockApp.browserManager.retrieveByIdentifier).toHaveBeenCalledWith('settings');
    });

    it('should handle check for updates click', () => {
      linuxMenu.buildAndSetAppMenu();

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
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const visitWebsiteItem = helpMenu.submenu.find((item: any) => item.label === 'Visit Website');

      expect(visitWebsiteItem).toBeDefined();
      await visitWebsiteItem.click();
      expect(shell.openExternal).toHaveBeenCalledWith('https://lobehub.com');
    });

    it('should handle github repo click', async () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const githubItem = helpMenu.submenu.find((item: any) => item.label === 'GitHub Repository');

      expect(githubItem).toBeDefined();
      await githubItem.click();
      expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/lobehub/lobe-chat');
    });

    it('should handle about dialog click', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const aboutItem = helpMenu.submenu.find((item: any) => item.label === 'About');

      expect(aboutItem).toBeDefined();
      aboutItem.click();
      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          title: 'About',
          buttons: ['OK'],
        }),
      );
    });

    it('should handle tray open click', () => {
      linuxMenu.buildTrayMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const openItem = template.find((item: any) => item.label?.includes('Open'));

      expect(openItem).toBeDefined();
      openItem.click();
      expect(mockApp.browserManager.showMainWindow).toHaveBeenCalled();
    });
  });

  describe('menu accelerators', () => {
    it('should use role for standard edit shortcuts (accelerators handled by Electron)', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const editMenu = template.find((item: any) => item.label === 'Edit');
      const copyItem = editMenu.submenu.find((item: any) => item.label === 'Copy');

      expect(copyItem.role).toBe('copy');
    });

    it('should use role for close (accelerator handled by Electron)', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const closeItem = fileMenu.submenu.find((item: any) => item.label === 'Close');

      expect(closeItem.role).toBe('close');
    });

    it('should use role for minimize (accelerator handled by Electron)', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const minimizeItem = fileMenu.submenu.find((item: any) => item.label === 'Minimize');

      expect(minimizeItem.role).toBe('minimize');
    });

    it('should use role for redo (accelerator handled by Electron)', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const editMenu = template.find((item: any) => item.label === 'Edit');
      const redoItem = editMenu.submenu.find((item: any) => item.label === 'Redo');

      expect(redoItem.role).toBe('redo');
    });

    it('should use role for fullscreen (accelerator handled by Electron)', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const viewMenu = template.find((item: any) => item.label === 'View');
      const fullscreenItem = viewMenu.submenu.find(
        (item: any) => item.label === 'Toggle Full Screen',
      );

      expect(fullscreenItem.role).toBe('togglefullscreen');
    });
  });

  describe('developer menu items', () => {
    it('should include dev tools shortcuts in developer menu', () => {
      linuxMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');

      expect(devMenu).toBeDefined();
      expect(devMenu.submenu.length).toBeGreaterThan(0);
    });

    it('should handle dev panel click', () => {
      linuxMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      const devPanelItem = devMenu.submenu.find((item: any) => item.label === 'Dev Panel');

      expect(devPanelItem).toBeDefined();
      devPanelItem.click();
      expect(mockApp.browserManager.retrieveByIdentifier).toHaveBeenCalledWith('devtools');
    });

    it('should use role for developer tools (accelerator handled by Electron)', () => {
      linuxMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');
      const devToolsItem = devMenu.submenu.find((item: any) => item.label === 'Developer Tools');

      expect(devToolsItem.role).toBe('toggleDevTools');
    });

    it('should include reload options in developer menu', () => {
      linuxMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Developer');

      const reloadItem = devMenu.submenu.find((item: any) => item.label === 'Reload');
      const forceReloadItem = devMenu.submenu.find((item: any) => item.label === 'Force Reload');

      expect(reloadItem).toBeDefined();
      expect(forceReloadItem).toBeDefined();
    });
  });

  describe('context menu templates', () => {
    it('should include copy and paste in chat context menu', () => {
      linuxMenu.buildContextMenu('chat');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const copyItem = template.find((item: any) => item.role === 'copy');
      const pasteItem = template.find((item: any) => item.role === 'paste');

      expect(copyItem).toBeDefined();
      expect(pasteItem).toBeDefined();
    });

    it('should use role for copy in context menus (accelerator handled by Electron)', () => {
      linuxMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const copyItem = template.find((item: any) => item.role === 'copy');

      expect(copyItem).toBeDefined();
      expect(copyItem.role).toBe('copy');
    });

    it('should include cut in editor context menu', () => {
      linuxMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const cutItem = template.find((item: any) => item.role === 'cut');

      expect(cutItem).toBeDefined();
      expect(cutItem.role).toBe('cut');
    });

    it('should include delete in editor context menu', () => {
      linuxMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const deleteItem = template.find((item: any) => item.role === 'delete');

      expect(deleteItem).toBeDefined();
    });

    it('should not include cut in chat context menu', () => {
      linuxMenu.buildContextMenu('chat');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const cutItem = template.find((item: any) => item.role === 'cut');

      expect(cutItem).toBeUndefined();
    });
  });

  describe('menu structure', () => {
    it('should have separators in menus', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const fileMenu = template.find((item: any) => item.label === 'File');
      const hasSeparator = fileMenu.submenu.some((item: any) => item.type === 'separator');

      expect(hasSeparator).toBe(true);
    });

    it('should have minimize and close in window menu', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const windowMenu = template.find((item: any) => item.label === 'Window');

      const minimizeItem = windowMenu.submenu.find((item: any) => item.role === 'minimize');
      const closeItem = windowMenu.submenu.find((item: any) => item.role === 'close');

      expect(minimizeItem).toBeDefined();
      expect(closeItem).toBeDefined();
    });

    it('should have zoom controls in view menu', () => {
      linuxMenu.buildAndSetAppMenu();

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

  describe('about dialog', () => {
    it('should show about dialog with app info', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const aboutItem = helpMenu.submenu.find((item: any) => item.label === 'About');

      aboutItem.click();

      expect(mockApp.i18n.ns).toHaveBeenCalledWith('common');
      expect(mockApp.i18n.ns).toHaveBeenCalledWith('dialog');
      expect(app.getName).toHaveBeenCalled();
      expect(app.getVersion).toHaveBeenCalled();
      expect(dialog.showMessageBox).toHaveBeenCalled();
    });

    it('should display app name and version in about dialog', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const aboutItem = helpMenu.submenu.find((item: any) => item.label === 'About');

      aboutItem.click();

      const callArgs = (dialog.showMessageBox as any).mock.calls[0][0];
      expect(callArgs.message).toContain('LobeChat');
      expect(callArgs.message).toContain('1.0.0');
    });
  });

  describe('i18n integration', () => {
    it('should use i18n for all menu labels', () => {
      linuxMenu.buildAndSetAppMenu();

      expect(mockApp.i18n.ns).toHaveBeenCalledWith('menu');
    });

    it('should request translations for tray menu', () => {
      linuxMenu.buildTrayMenu();

      expect(mockApp.i18n.ns).toHaveBeenCalled();
      expect(app.getName).toHaveBeenCalled();
    });

    it('should use multiple i18n namespaces for about dialog', () => {
      linuxMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const aboutItem = helpMenu.submenu.find((item: any) => item.label === 'About');

      vi.clearAllMocks();
      aboutItem.click();

      expect(mockApp.i18n.ns).toHaveBeenCalledWith('common');
      expect(mockApp.i18n.ns).toHaveBeenCalledWith('dialog');
    });
  });
});
