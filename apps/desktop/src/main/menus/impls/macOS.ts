/* eslint-disable unicorn/no-array-push-push */
import { Menu, MenuItemConstructorOptions, app, clipboard, shell } from 'electron';
import * as path from 'node:path';

import { isDev } from '@/const/env';
import NotificationCtr from '@/controllers/NotificationCtr';
import SystemController from '@/controllers/SystemCtr';

import type { ContextMenuData, IMenuPlatform, MenuOptions } from '../types';
import { BaseMenuPlatform } from './BaseMenuPlatform';

export class MacOSMenu extends BaseMenuPlatform implements IMenuPlatform {
  private appMenu: Menu | null = null;
  private trayMenu: Menu | null = null;

  buildAndSetAppMenu(options?: MenuOptions): Menu {
    const template = this.getAppMenuTemplate(options);

    this.appMenu = Menu.buildFromTemplate(template);

    Menu.setApplicationMenu(this.appMenu);

    return this.appMenu;
  }

  buildContextMenu(type: string, data?: ContextMenuData): Menu {
    let template: MenuItemConstructorOptions[];
    switch (type) {
      case 'chat': {
        template = this.getChatContextMenuTemplate(data);
        break;
      }
      case 'editor': {
        template = this.getEditorContextMenuTemplate(data);
        break;
      }
      default: {
        template = this.getDefaultContextMenuTemplate(data);
      }
    }
    return Menu.buildFromTemplate(template);
  }

  buildTrayMenu(): Menu {
    const template = this.getTrayMenuTemplate();
    this.trayMenu = Menu.buildFromTemplate(template);
    return this.trayMenu;
  }

  refresh(options?: MenuOptions): void {
    // Rebuild Application menu
    this.buildAndSetAppMenu(options);
    // If tray menu exists, rebuild it as well (if dynamic update is needed)
    // this.trayMenu = this.buildTrayMenu();
    // Need to consider how to update the menu for existing tray icons
  }

  // --- Private methods: define menu templates and logic ---

  private getAppMenuTemplate(options?: MenuOptions): MenuItemConstructorOptions[] {
    const appName = app.getName();
    const showDev = isDev || options?.showDevItems;
    // Create namespaced translation function
    const t = this.app.i18n.ns('menu');

    // Add debug logging
    // console.log('[MacOSMenu] Menu rendering, i18n instance:', !!this.app.i18n);

    const template: MenuItemConstructorOptions[] = [
      {
        label: appName,
        submenu: [
          {
            click: async () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('navigate', { path: '/settings/about' });
            },
            label: t('macOS.about', { appName }),
          },
          {
            click: () => {
              this.app.updaterManager.checkForUpdates({ manual: true });
            },
            label: t('common.checkUpdates'),
          },
          { type: 'separator' },
          {
            accelerator: 'Command+,',
            click: async () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('navigate', { path: '/settings' });
            },
            label: t('macOS.preferences'),
          },
          { type: 'separator' },
          {
            label: t('macOS.services'),
            role: 'services',
            submenu: [],
          },
          { type: 'separator' },
          { label: t('macOS.hide', { appName }), role: 'hide' },
          { label: t('macOS.hideOthers'), role: 'hideOthers' },
          { label: t('macOS.unhide'), role: 'unhide' },
          { type: 'separator' },
          { label: t('file.quit'), role: 'quit' },
        ],
      },
      {
        label: t('file.title'),
        submenu: [
          {
            accelerator: 'Command+N',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewTopic');
            },
            label: t('file.newTopic'),
          },
          { type: 'separator' },
          {
            accelerator: 'Alt+Command+A',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewAgent');
            },
            label: t('file.newAgent'),
          },
          {
            accelerator: 'Alt+Command+G',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewAgentGroup');
            },
            label: t('file.newAgentGroup'),
          },
          {
            accelerator: 'Alt+Command+P',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewPage');
            },
            label: t('file.newPage'),
          },
          { type: 'separator' },
          { label: t('window.close'), role: 'close' },
        ],
      },
      {
        label: t('edit.title'),
        submenu: [
          { label: t('edit.undo'), role: 'undo' },
          { label: t('edit.redo'), role: 'redo' },
          { type: 'separator' },
          { label: t('edit.cut'), role: 'cut' },
          { label: t('edit.copy'), role: 'copy' },
          { label: t('edit.paste'), role: 'paste' },
          { type: 'separator' },
          {
            label: t('edit.speech'),
            submenu: [
              { label: t('edit.startSpeaking'), role: 'startSpeaking' },
              { label: t('edit.stopSpeaking'), role: 'stopSpeaking' },
            ],
          },
          { type: 'separator' },
          { label: t('edit.selectAll'), role: 'selectAll' },
        ],
      },
      {
        label: t('view.title'),
        submenu: [
          { label: t('view.reload'), role: 'reload' },
          { label: t('view.forceReload'), role: 'forceReload' },
          { accelerator: 'F12', label: t('dev.devTools'), role: 'toggleDevTools' },
          { type: 'separator' },
          { label: t('view.resetZoom'), role: 'resetZoom' },
          { label: t('view.zoomIn'), role: 'zoomIn' },
          { label: t('view.zoomOut'), role: 'zoomOut' },
          { type: 'separator' },
          { accelerator: 'F11', label: t('view.toggleFullscreen'), role: 'togglefullscreen' },
        ],
      },
      {
        label: t('history.title'),
        submenu: [
          {
            accelerator: 'Command+[',
            acceleratorWorksWhenHidden: true,
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.broadcast('historyGoBack');
            },
            label: t('history.back'),
          },
          {
            accelerator: 'Command+]',
            acceleratorWorksWhenHidden: true,
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.broadcast('historyGoForward');
            },
            label: t('history.forward'),
          },
          { type: 'separator' },
          {
            accelerator: 'Shift+Command+H',
            acceleratorWorksWhenHidden: true,
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.broadcast('navigate', { path: '/' });
            },
            label: t('history.home'),
          },
        ],
      },
      {
        label: t('window.title'),
        role: 'windowMenu',
      },
      {
        label: t('help.title'),
        role: 'help',
        submenu: [
          {
            click: async () => {
              await shell.openExternal('https://lobehub.com');
            },
            label: t('help.visitWebsite'),
          },
          {
            click: async () => {
              await shell.openExternal('https://github.com/lobehub/lobe-chat');
            },
            label: t('help.githubRepo'),
          },
          {
            click: async () => {
              await shell.openExternal('https://github.com/lobehub/lobe-chat/issues/new/choose');
            },
            label: t('help.reportIssue'),
          },
          { type: 'separator' },
          {
            click: () => {
              const logsPath = app.getPath('logs');
              console.log(`[Menu] Opening logs directory: ${logsPath}`);
              shell.openPath(logsPath).catch((err) => {
                console.error(`[Menu] Error opening path ${logsPath}:`, err);
                // Optionally show an error dialog to the user
              });
            },
            label: t('help.openLogsDir'),
          },
          {
            click: () => {
              const userDataPath = app.getPath('userData');
              console.log(`[Menu] Opening user data directory: ${userDataPath}`);
              shell.openPath(userDataPath).catch((err) => {
                console.error(`[Menu] Error opening path ${userDataPath}:`, err);
                // Optionally show an error dialog to the user
              });
            },
            label: t('help.openConfigDir'),
          },
        ],
      },
    ];

    if (showDev) {
      template.push({
        label: t('dev.title'),
        submenu: [
          {
            click: () => {
              this.app.browserManager.retrieveByIdentifier('devtools').show();
            },
            label: t('dev.devPanel'),
          },
          {
            click: () => {
              this.app.menuManager.rebuildAppMenu();
            },
            label: t('dev.refreshMenu'),
          },
          { type: 'separator' },
          {
            label: t('dev.permissions.title'),
            submenu: [
              {
                click: () => {
                  const notificationCtr = this.app.getController(NotificationCtr);
                  void notificationCtr.requestNotificationPermission();
                },
                label: t('dev.permissions.notification.request'),
              },
              { type: 'separator' },
              {
                click: () => {
                  const systemCtr = this.app.getController(SystemController);
                  void systemCtr.requestAccessibilityAccess();
                },
                label: t('dev.permissions.accessibility.request'),
              },
              {
                click: () => {
                  const systemCtr = this.app.getController(SystemController);
                  void systemCtr.requestMicrophoneAccess();
                },
                label: t('dev.permissions.microphone.request'),
              },
              {
                click: () => {
                  const systemCtr = this.app.getController(SystemController);
                  void systemCtr.requestScreenAccess();
                },
                label: t('dev.permissions.screen.request'),
              },
              { type: 'separator' },
              {
                click: () => {
                  const systemCtr = this.app.getController(SystemController);
                  void systemCtr.promptFullDiskAccessIfNotGranted();
                },
                label: t('dev.permissions.fullDisk.request'),
              },
            ],
          },
          {
            click: () => {
              const userDataPath = app.getPath('userData');
              shell.openPath(userDataPath).catch((err) => {
                console.error(`[Menu] Error opening path ${userDataPath}:`, err);
              });
            },
            label: t('dev.openUserDataDir'),
          },
          {
            click: () => {
              // @ts-expect-error cache directory seems to be temporarily missing from type definitions
              const cachePath = app.getPath('cache');

              const updaterCachePath = path.join(cachePath, `${app.getName()}-updater`);
              shell.openPath(updaterCachePath).catch((err) => {
                console.error(`[Menu] Error opening path ${updaterCachePath}:`, err);
              });
            },
            label: t('dev.openUpdaterCacheDir'),
          },
          {
            click: () => {
              this.app.storeManager.openInEditor();
            },
            label: t('dev.openSettingsFile'),
          },
          { type: 'separator' },
          {
            label: t('dev.updaterSimulation'),
            submenu: [
              {
                click: () => {
                  this.app.updaterManager.simulateUpdateAvailable();
                },
                label: t('dev.simulateAutoDownload'),
              },
              {
                click: () => {
                  this.app.updaterManager.simulateDownloadProgress();
                },
                label: t('dev.simulateDownloadProgress'),
              },
              {
                click: () => {
                  this.app.updaterManager.simulateUpdateDownloaded();
                },
                label: t('dev.simulateDownloadComplete'),
              },
            ],
          },
        ],
      });
    }

    return template;
  }

  private getDefaultContextMenuTemplate(data?: ContextMenuData): MenuItemConstructorOptions[] {
    const t = this.app.i18n.ns('menu');
    const hasText = Boolean(data?.selectionText?.trim());
    const hasLink = Boolean(data?.linkURL);
    const hasImage = data?.mediaType === 'image' && Boolean(data?.srcURL);

    const template: MenuItemConstructorOptions[] = [];

    // Look Up (macOS only) - only when text is selected
    if (hasText) {
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.showDefinitionForSelection();
        },
        label: t('edit.lookUp'),
      });
      template.push({ type: 'separator' });
    }

    // Search with Google - only when text is selected
    if (hasText) {
      template.push({
        click: () => {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(data!.selectionText!.trim())}`;
          shell.openExternal(searchUrl);
        },
        label: t('context.searchWithGoogle'),
      });
      template.push({ type: 'separator' });
    }

    // Link actions
    if (hasLink) {
      template.push({
        click: () => shell.openExternal(data!.linkURL!),
        label: t('context.openLink'),
      });
      template.push({
        click: () => clipboard.writeText(data!.linkURL!),
        label: t('context.copyLink'),
      });
      template.push({ type: 'separator' });
    }

    // Image actions
    if (hasImage) {
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.downloadURL(data!.srcURL!);
        },
        label: t('context.saveImage'),
      });
      template.push({
        click: () => {
          clipboard.writeText(data!.srcURL!);
        },
        label: t('context.copyImageAddress'),
      });
      template.push({ type: 'separator' });
    }

    // Standard edit actions
    template.push(
      { label: t('edit.cut'), role: 'cut' },
      { label: t('edit.copy'), role: 'copy' },
      { label: t('edit.paste'), role: 'paste' },
      { label: t('edit.selectAll'), role: 'selectAll' },
    );

    // Inspect Element in dev mode
    if (isDev && data?.x !== undefined && data?.y !== undefined) {
      template.push({ type: 'separator' });
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.inspectElement(data.x!, data.y!);
        },
        label: t('context.inspectElement'),
      });
    }

    return template;
  }

  private getChatContextMenuTemplate(data?: ContextMenuData): MenuItemConstructorOptions[] {
    const t = this.app.i18n.ns('menu');
    const hasText = Boolean(data?.selectionText?.trim());
    const hasLink = Boolean(data?.linkURL);
    const hasImage = data?.mediaType === 'image' && Boolean(data?.srcURL);

    const template: MenuItemConstructorOptions[] = [];

    // Look Up (macOS only) - only when text is selected
    if (hasText) {
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.showDefinitionForSelection();
        },
        label: t('edit.lookUp'),
      });
      template.push({ type: 'separator' });
    }

    // Search with Google - only when text is selected
    if (hasText) {
      template.push({
        click: () => {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(data!.selectionText!.trim())}`;
          shell.openExternal(searchUrl);
        },
        label: t('context.searchWithGoogle'),
      });
      template.push({ type: 'separator' });
    }

    // Link actions
    if (hasLink) {
      template.push({
        click: () => shell.openExternal(data!.linkURL!),
        label: t('context.openLink'),
      });
      template.push({
        click: () => clipboard.writeText(data!.linkURL!),
        label: t('context.copyLink'),
      });
      template.push({ type: 'separator' });
    }

    // Image actions
    if (hasImage) {
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.downloadURL(data!.srcURL!);
        },
        label: t('context.saveImage'),
      });
      template.push({
        click: () => {
          clipboard.writeText(data!.srcURL!);
        },
        label: t('context.copyImageAddress'),
      });
      template.push({ type: 'separator' });
    }

    // Standard edit actions for chat (copy/paste focused)
    template.push(
      { label: t('edit.copy'), role: 'copy' },
      { label: t('edit.paste'), role: 'paste' },
      { type: 'separator' },
      { label: t('edit.selectAll'), role: 'selectAll' },
    );

    // Inspect Element in dev mode
    if (isDev && data?.x !== undefined && data?.y !== undefined) {
      template.push({ type: 'separator' });
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.inspectElement(data.x!, data.y!);
        },
        label: t('context.inspectElement'),
      });
    }

    return template;
  }

  private getEditorContextMenuTemplate(data?: ContextMenuData): MenuItemConstructorOptions[] {
    const t = this.app.i18n.ns('menu');
    const hasText = Boolean(data?.selectionText?.trim());

    const template: MenuItemConstructorOptions[] = [];

    // Look Up (macOS only) - only when text is selected
    if (hasText) {
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.showDefinitionForSelection();
        },
        label: t('edit.lookUp'),
      });
      template.push({ type: 'separator' });
    }

    // Search with Google - only when text is selected
    if (hasText) {
      template.push({
        click: () => {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(data!.selectionText!.trim())}`;
          shell.openExternal(searchUrl);
        },
        label: t('context.searchWithGoogle'),
      });
      template.push({ type: 'separator' });
    }

    // Standard edit actions for editor (full edit capabilities)
    template.push(
      { label: t('edit.cut'), role: 'cut' },
      { label: t('edit.copy'), role: 'copy' },
      { label: t('edit.paste'), role: 'paste' },
      { type: 'separator' },
      { label: t('edit.selectAll'), role: 'selectAll' },
      { type: 'separator' },
      { label: t('edit.delete'), role: 'delete' },
    );

    // Inspect Element in dev mode
    if (isDev && data?.x !== undefined && data?.y !== undefined) {
      template.push({ type: 'separator' });
      template.push({
        click: () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.webContents.inspectElement(data.x!, data.y!);
        },
        label: t('context.inspectElement'),
      });
    }

    return template;
  }

  private getTrayMenuTemplate(): MenuItemConstructorOptions[] {
    const t = this.app.i18n.ns('menu');
    const appName = app.getName();

    return [
      {
        click: () => this.app.browserManager.showMainWindow(),
        label: t('tray.show', { appName }),
      },
      {
        click: async () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.show();
          mainWindow.broadcast('navigate', { path: '/settings' });
        },
        label: t('file.preferences'),
      },
      { type: 'separator' },
      { label: t('tray.quit'), role: 'quit' },
    ];
  }
}
