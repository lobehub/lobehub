import path from 'node:path';

import type { MenuItemConstructorOptions } from 'electron';
import { app, clipboard, Menu, shell } from 'electron';

import { isDev } from '@/const/env';
import { HETERO_AGENT_DIR } from '@/const/heteroAgent';

import type { ContextMenuData, IMenuPlatform, MenuOptions } from '../types';
import { BaseMenuPlatform } from './BaseMenuPlatform';

export class WindowsMenu extends BaseMenuPlatform implements IMenuPlatform {
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
    this.buildAndSetAppMenu(options);
    // If it's necessary to update tray menu, logic can be added here
  }

  private getAppMenuTemplate(options?: MenuOptions): MenuItemConstructorOptions[] {
    const showDev = isDev || options?.showDevItems;
    const t = this.app.i18n.ns('menu');

    const template: MenuItemConstructorOptions[] = [
      {
        label: t('file.title'),
        submenu: [
          {
            accelerator: 'Ctrl+N',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewTopic');
            },
            label: t('file.newTopic'),
          },
          {
            accelerator: 'Ctrl+T',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewTab');
            },
            label: t('file.newTab'),
          },
          { type: 'separator' },
          {
            accelerator: 'Alt+Ctrl+A',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewAgent');
            },
            label: t('file.newAgent'),
          },
          {
            accelerator: 'Alt+Ctrl+G',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewAgentGroup');
            },
            label: t('file.newAgentGroup'),
          },
          {
            accelerator: 'Alt+Ctrl+P',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('createNewPage');
            },
            label: t('file.newPage'),
          },
          { type: 'separator' },
          {
            click: async () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.show();
              mainWindow.broadcast('navigate', { path: '/settings' });
            },
            label: t('file.preferences'),
          },
          this.getUpdateMenuItem(t),
          { type: 'separator' },
          {
            accelerator: 'Alt+F4',
            label: t('window.close'),
            role: 'close',
          },
          { label: t('window.minimize'), role: 'minimize' },
          { type: 'separator' },
          { label: t('file.quit'), role: 'quit' },
        ],
      },
      {
        label: t('edit.title'),
        submenu: [
          { label: t('edit.undo'), role: 'undo' },
          { accelerator: 'Ctrl+Y', label: t('edit.redo'), role: 'redo' },
          { type: 'separator' },
          { label: t('edit.cut'), role: 'cut' },
          { label: t('edit.copy'), role: 'copy' },
          { label: t('edit.paste'), role: 'paste' },
          { type: 'separator' },
          { label: t('edit.selectAll'), role: 'selectAll' },
        ],
      },
      {
        label: t('view.title'),
        submenu: [
          this.buildDevToolsMenuItem(t('dev.devTools'), 'F12'),
          { type: 'separator' },
          this.buildZoomMenuItem('reset', t('view.resetZoom'), 'CmdOrCtrl+0'),
          ...this.buildZoomMenuItems('in', t('view.zoomIn'), 'CmdOrCtrl+=', ['CmdOrCtrl+Plus']),
          this.buildZoomMenuItem('out', t('view.zoomOut'), 'CmdOrCtrl+-'),
          { type: 'separator' },
          { label: t('view.toggleFullscreen'), role: 'togglefullscreen' },
        ],
      },
      {
        label: t('history.title'),
        submenu: [
          {
            accelerator: 'Alt+Left',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.broadcast('historyGoBack');
            },
            label: t('history.back'),
          },
          {
            accelerator: 'Alt+Right',
            click: () => {
              const mainWindow = this.app.browserManager.getMainWindow();
              mainWindow.broadcast('historyGoForward');
            },
            label: t('history.forward'),
          },
          { type: 'separator' },
          {
            accelerator: 'Ctrl+Shift+H',
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
        submenu: [
          { label: t('window.minimize'), role: 'minimize' },
          {
            accelerator: 'CmdOrCtrl+W',
            click: (_item, targetWindow) => this.closeFocusedTabOrWindow(targetWindow),
            label: t('window.close'),
          },
        ],
      },
      {
        label: t('help.title'),
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
          { type: 'separator' },
          {
            click: () => {
              const heteroAgentPath = path.join(this.app.appStoragePath, HETERO_AGENT_DIR);
              console.info(`[Menu] Opening HeteroAgent directory: ${heteroAgentPath}`);
              shell.openPath(heteroAgentPath).catch((err) => {
                console.error(`[Menu] Error opening path ${heteroAgentPath}:`, err);
              });
            },
            label: t('help.openHeteroAgentDir'),
          },
          {
            checked: this.app.storeManager.get('heteroTracingEnabled', false),
            click: (item) => {
              this.app.storeManager.set('heteroTracingEnabled', item.checked);
            },
            label: t('help.toggleHeteroTracing'),
            type: 'checkbox',
          },
        ],
      },
    ];

    if (showDev) {
      template.push({
        label: t('dev.title'),
        submenu: [
          { label: t('dev.reload'), role: 'reload' },
          { label: t('dev.forceReload'), role: 'forceReload' },
          this.buildDevToolsMenuItem(t('dev.devTools')),
          { type: 'separator' },
          {
            click: () => {
              this.app.browserManager.retrieveByIdentifier('devtools').show();
            },
            label: t('dev.devPanel'),
          },
        ],
      });
    }

    return template;
  }

  private getUpdateMenuItem(t: (key: string, opts?: any) => string): MenuItemConstructorOptions {
    const { stage } = this.app.updaterManager.getUpdaterState();

    switch (stage) {
      case 'checking': {
        return { enabled: false, label: t('common.checkingUpdates') };
      }
      case 'downloading': {
        return { enabled: false, label: t('common.downloadingUpdate') };
      }
      case 'downloaded': {
        return {
          click: () => this.app.updaterManager.installNow(),
          label: t('common.restartToUpdate'),
        };
      }
      case 'latest': {
        return { enabled: false, label: t('common.isLatestVersion') };
      }
      default: {
        return {
          click: () => this.app.updaterManager.checkForUpdates({ manual: true }),
          label: t('common.checkUpdates'),
        };
      }
    }
  }

  private getDefaultContextMenuTemplate(data?: ContextMenuData): MenuItemConstructorOptions[] {
    const t = this.app.i18n.ns('menu');
    const hasText = Boolean(data?.selectionText?.trim());
    const hasLink = Boolean(data?.linkURL);
    const hasImage = data?.mediaType === 'image' && Boolean(data?.srcURL);

    const template: MenuItemConstructorOptions[] = [];

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

  private getChatContextMenuTemplate(data?: ContextMenuData): MenuItemConstructorOptions[] {
    const t = this.app.i18n.ns('menu');
    const hasText = Boolean(data?.selectionText?.trim());
    const hasLink = Boolean(data?.linkURL);
    const hasImage = data?.mediaType === 'image' && Boolean(data?.srcURL);

    const template: MenuItemConstructorOptions[] = [];

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

    // Standard edit actions for chat
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

    // Standard edit actions for editor
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
        label: t('tray.open', { appName }),
      },
      {
        click: () => this.app.screenCaptureManager.startSession(),
        label: t('tray.openMiniToolbar'),
      },
      {
        click: () => this.app.browserManager.openQuickChatPopup(),
        label: t('tray.quickChat'),
      },
      { type: 'separator' },
      {
        click: async () => {
          const mainWindow = this.app.browserManager.getMainWindow();
          mainWindow.show();
          mainWindow.broadcast('navigate', { path: '/settings' });
        },
        label: t('tray.settings'),
      },
      { type: 'separator' },
      { label: t('tray.quit'), role: 'quit' },
    ];
  }
}
