import { Menu, app, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import menuTranslations from '@/locales/default/menu';

import { MacOSMenu } from './macOS';

// Mock Electron modules
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    getName: vi.fn(() => 'LobeChat'),
    getPath: vi.fn((type: string) => {
      if (type === 'logs') return '/path/to/logs';
      if (type === 'userData') return '/path/to/userData';
      if (type === 'cache') return '/path/to/cache';
      return '/path/to/default';
    }),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(() => Promise.resolve('')),
  },
}));

// Mock isDev
vi.mock('@/const/env', () => ({
  isDev: false,
}));

// Mock App instance
const createMockApp = () => {
  const mockT = vi.fn((key: string, params?: any) => {
    let translation = menuTranslations[key as keyof typeof menuTranslations] || key;
    if (params && typeof translation === 'string') {
      Object.keys(params).forEach((paramKey) => {
        translation = translation.replace(
          new RegExp(`{{${paramKey}}}`, 'g'),
          params[paramKey] as string,
        );
      });
    }
    return translation;
  });

  return {
    i18n: {
      ns: vi.fn(() => mockT),
    },
    browserManager: {
      getMainWindow: vi.fn(() => ({
        broadcast: vi.fn(),
        loadUrl: vi.fn(),
        show: vi.fn(),
      })),
      showMainWindow: vi.fn(),
      retrieveByIdentifier: vi.fn(() => ({
        show: vi.fn(),
      })),
    },
    updaterManager: {
      checkForUpdates: vi.fn(),
      simulateUpdateAvailable: vi.fn(),
      simulateDownloadProgress: vi.fn(),
      simulateUpdateDownloaded: vi.fn(),
    },
    menuManager: {
      rebuildAppMenu: vi.fn(),
    },
    storeManager: {
      openInEditor: vi.fn(),
    },
  } as unknown as App;
};

describe('MacOSMenu', () => {
  let macOSMenu: MacOSMenu;
  let mockApp: App;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = createMockApp();
    macOSMenu = new MacOSMenu(mockApp);
  });

  describe('buildAndSetAppMenu', () => {
    it('should build and set application menu', () => {
      const menu = macOSMenu.buildAndSetAppMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should include developer menu when showDevItems is true', () => {
      macOSMenu.buildAndSetAppMenu({ showDevItems: true });

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Development');
      expect(devMenu).toBeDefined();
    });

    it('should not include developer menu when showDevItems is false', () => {
      macOSMenu.buildAndSetAppMenu({ showDevItems: false });

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Development');
      expect(devMenu).toBeUndefined();
    });

    it('should create menu with correct structure', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      expect(template).toBeInstanceOf(Array);
      expect(template.length).toBeGreaterThan(0);
    });
  });

  describe('buildContextMenu', () => {
    it('should build chat context menu', () => {
      const menu = macOSMenu.buildContextMenu('chat');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should build editor context menu', () => {
      const menu = macOSMenu.buildContextMenu('editor');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should build default context menu for unknown type', () => {
      const menu = macOSMenu.buildContextMenu('unknown');

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should pass data to chat context menu', () => {
      const data = { selectionText: 'test selection', x: 100, y: 200 };
      macOSMenu.buildContextMenu('chat', data);

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
    });
  });

  describe('buildTrayMenu', () => {
    it('should build tray menu', () => {
      const menu = macOSMenu.buildTrayMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(menu).toBeDefined();
    });

    it('should include show and quit items in tray menu', () => {
      macOSMenu.buildTrayMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      expect(template.length).toBeGreaterThan(0);
      expect(template.some((item: any) => item.label?.includes('Show'))).toBe(true);
      expect(template.some((item: any) => item.label === 'Quit')).toBe(true);
    });
  });

  describe('refresh', () => {
    it('should rebuild application menu', () => {
      macOSMenu.refresh();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalled();
    });

    it('should pass options to rebuild', () => {
      macOSMenu.refresh({ showDevItems: true });

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
    });
  });

  describe('menu item click handlers', () => {
    it('should handle check for updates click', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const appMenu = template[0];
      const checkUpdatesItem = appMenu.submenu.find(
        (item: any) => item.label === 'Check for updates...',
      );

      expect(checkUpdatesItem).toBeDefined();
      checkUpdatesItem.click();
      expect(mockApp.updaterManager.checkForUpdates).toHaveBeenCalledWith({ manual: true });
    });

    it('should handle preferences click', async () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const appMenu = template[0];
      const preferencesItem = appMenu.submenu.find((item: any) => item.label === 'Preferences...');

      expect(preferencesItem).toBeDefined();
      await preferencesItem.click();
      expect(mockApp.browserManager.getMainWindow).toHaveBeenCalled();
    });

    it('should handle visit website click', async () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const visitWebsiteItem = helpMenu.submenu.find((item: any) => item.label === 'Open Website');

      expect(visitWebsiteItem).toBeDefined();
      await visitWebsiteItem.click();
      expect(shell.openExternal).toHaveBeenCalledWith('https://lobehub.com');
    });

    it('should handle github repo click', async () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const githubItem = helpMenu.submenu.find((item: any) => item.label === 'GitHub Repository');

      expect(githubItem).toBeDefined();
      await githubItem.click();
      expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/lobehub/lobe-chat');
    });

    it('should handle open logs directory click', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');
      const logsItem = helpMenu.submenu.find((item: any) => item.label === 'Open Logs Directory');

      expect(logsItem).toBeDefined();
      logsItem.click();
      expect(app.getPath).toHaveBeenCalledWith('logs');
      expect(shell.openPath).toHaveBeenCalledWith('/path/to/logs');
    });

    it('should handle tray show click', () => {
      macOSMenu.buildTrayMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const showItem = template.find((item: any) => item.label?.includes('Show'));

      expect(showItem).toBeDefined();
      showItem.click();
      expect(mockApp.browserManager.showMainWindow).toHaveBeenCalled();
    });
  });

  describe('menu accelerators', () => {
    it('should set correct accelerator for preferences', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const appMenu = template[0];
      const preferencesItem = appMenu.submenu.find((item: any) => item.label === 'Preferences...');

      expect(preferencesItem.accelerator).toBe('Command+,');
    });

    it('should use role for quit (accelerator handled by Electron)', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const appMenu = template[0];
      const quitItem = appMenu.submenu.find((item: any) => item.label === 'Quit');

      expect(quitItem.role).toBe('quit');
    });

    it('should use role for copy in edit menu (accelerator handled by Electron)', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const editMenu = template.find((item: any) => item.label === 'Edit');
      const copyItem = editMenu.submenu.find((item: any) => item.label === 'Copy');

      expect(copyItem.role).toBe('copy');
    });

    it('should set correct accelerators for history navigation', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const historyMenu = template.find(
        (item: any) => item.label === menuTranslations['history.title'],
      );

      const backItem = historyMenu.submenu.find((item: any) => item.label === 'Back');
      const forwardItem = historyMenu.submenu.find((item: any) => item.label === 'Forward');
      const homeItem = historyMenu.submenu.find((item: any) => item.label === 'Home');

      expect(backItem.accelerator).toBe('Command+[');
      expect(forwardItem.accelerator).toBe('Command+]');
      expect(homeItem.accelerator).toBe('Shift+Command+H');
    });
  });

  describe('developer menu items', () => {
    it('should include dev panel in developer menu', () => {
      macOSMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Development');
      const devPanelItem = devMenu.submenu.find((item: any) => item.label === 'Developer Panel');

      expect(devPanelItem).toBeDefined();
    });

    it('should handle dev panel click', () => {
      macOSMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Development');
      const devPanelItem = devMenu.submenu.find((item: any) => item.label === 'Developer Panel');

      devPanelItem.click();
      expect(mockApp.browserManager.retrieveByIdentifier).toHaveBeenCalledWith('devtools');
    });

    it('should handle refresh menu click', () => {
      macOSMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Development');
      const refreshMenuItem = devMenu.submenu.find((item: any) => item.label === 'Refresh Menu');

      refreshMenuItem.click();
      expect(mockApp.menuManager.rebuildAppMenu).toHaveBeenCalled();
    });

    it('should include updater simulation submenu', () => {
      macOSMenu.buildAndSetAppMenu({ showDevItems: true });

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const devMenu = template.find((item: any) => item.label === 'Development');
      const updaterMenu = devMenu.submenu.find((item: any) => item.label === 'Updater Simulation');

      expect(updaterMenu).toBeDefined();
      expect(updaterMenu.submenu).toBeInstanceOf(Array);
      expect(updaterMenu.submenu.length).toBeGreaterThan(0);
    });
  });

  describe('context menu templates', () => {
    it('should include copy and paste in chat context menu', () => {
      macOSMenu.buildContextMenu('chat');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const copyItem = template.find((item: any) => item.role === 'copy');
      const pasteItem = template.find((item: any) => item.role === 'paste');

      expect(copyItem).toBeDefined();
      expect(pasteItem).toBeDefined();
    });

    it('should include cut in editor context menu but not in chat', () => {
      macOSMenu.buildContextMenu('editor');
      const editorTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0];

      vi.clearAllMocks();

      macOSMenu.buildContextMenu('chat');
      const chatTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0];

      const editorCutItem = editorTemplate.find((item: any) => item.role === 'cut');
      const chatCutItem = chatTemplate.find((item: any) => item.role === 'cut');

      expect(editorCutItem).toBeDefined();
      expect(chatCutItem).toBeUndefined();
    });

    it('should include delete in editor context menu', () => {
      macOSMenu.buildContextMenu('editor');

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const deleteItem = template.find((item: any) => item.role === 'delete');

      expect(deleteItem).toBeDefined();
    });
  });

  describe('menu roles', () => {
    it('should set window role for window menu', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const windowMenu = template.find((item: any) => item.label === 'Window');

      expect(windowMenu.role).toBe('windowMenu');
    });

    it('should set help role for help menu', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const helpMenu = template.find((item: any) => item.label === 'Help');

      expect(helpMenu.role).toBe('help');
    });

    it('should set services submenu in app menu', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const appMenu = template[0];
      const servicesItem = appMenu.submenu.find((item: any) => item.role === 'services');

      expect(servicesItem).toBeDefined();
      expect(servicesItem.label).toBe('Services');
    });
  });

  describe('i18n integration', () => {
    it('should use i18n for all menu labels', () => {
      macOSMenu.buildAndSetAppMenu();

      expect(mockApp.i18n.ns).toHaveBeenCalledWith('menu');
    });

    it('should pass app name to translations', () => {
      macOSMenu.buildAndSetAppMenu();

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
      const appMenu = template[0];

      expect(app.getName).toHaveBeenCalled();
      expect(appMenu.label).toBe('LobeChat');
    });
  });
});
