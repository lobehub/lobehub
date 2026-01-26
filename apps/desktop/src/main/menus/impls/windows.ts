/* eslint-disable unicorn/no-array-push-push */
import { Menu, MenuItemConstructorOptions, app, clipboard, shell } from 'electron';

import { isDev } from '@/const/env';

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
    // 如果有必要更新托盘菜单，可以在这里添加逻辑
  }

  private getAppMenuTemplate(options?: MenuOptions): MenuItemConstructorOptions[] {
    const showDev = isDev || options?.showDevItems;
    const t = this.app.i18n.ns('menu');

    const template: MenuItemConstructorOptions[] = [
      {
        label: t('file.title'),
        submenu: [
          {
            click: () => this.app.browserManager.retrieveByIdentifier('settings').show(),
            label: t('file.preferences'),
          },
          {
            click: () => {
              this.app.updaterManager.checkForUpdates({ manual: true });
            },
            label: t('common.checkUpdates'),
          },
          { type: 'separator' },
          {
            accelerator: 'Alt+F4',
            label: t('window.close'),
            role: 'close',
          },
          {
            accelerator: 'Ctrl+M',
            label: t('window.minimize'),
            role: 'minimize',
          },
          { type: 'separator' },
          { label: t('file.quit'), role: 'quit' },
        ],
      },
      {
        label: t('edit.title'),
        submenu: [
          { accelerator: 'Ctrl+Z', label: t('edit.undo'), role: 'undo' },
          { accelerator: 'Ctrl+Y', label: t('edit.redo'), role: 'redo' },
          { type: 'separator' },
          { accelerator: 'Ctrl+X', label: t('edit.cut'), role: 'cut' },
          { accelerator: 'Ctrl+C', label: t('edit.copy'), role: 'copy' },
          { accelerator: 'Ctrl+V', label: t('edit.paste'), role: 'paste' },
          { type: 'separator' },
          { accelerator: 'Ctrl+A', label: t('edit.selectAll'), role: 'selectAll' },
        ],
      },
      {
        label: t('view.title'),
        submenu: [
          { accelerator: 'Ctrl+0', label: t('view.resetZoom'), role: 'resetZoom' },
          { accelerator: 'Ctrl+Plus', label: t('view.zoomIn'), role: 'zoomIn' },
          { accelerator: 'Ctrl+-', label: t('view.zoomOut'), role: 'zoomOut' },
          { type: 'separator' },
          { accelerator: 'F11', label: t('view.toggleFullscreen'), role: 'togglefullscreen' },
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
          { label: t('window.close'), role: 'close' },
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
        ],
      },
    ];

    if (showDev) {
      template.push({
        label: t('dev.title'),
        submenu: [
          { accelerator: 'Ctrl+R', label: t('dev.reload'), role: 'reload' },
          { accelerator: 'Ctrl+Shift+R', label: t('dev.forceReload'), role: 'forceReload' },
          { accelerator: 'Ctrl+Shift+I', label: t('dev.devTools'), role: 'toggleDevTools' },
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
      { accelerator: 'Ctrl+C', label: t('edit.copy'), role: 'copy' },
      { accelerator: 'Ctrl+V', label: t('edit.paste'), role: 'paste' },
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
      { accelerator: 'Ctrl+X', label: t('edit.cut'), role: 'cut' },
      { accelerator: 'Ctrl+C', label: t('edit.copy'), role: 'copy' },
      { accelerator: 'Ctrl+V', label: t('edit.paste'), role: 'paste' },
      { type: 'separator' },
      { accelerator: 'Ctrl+A', label: t('edit.selectAll'), role: 'selectAll' },
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
      { type: 'separator' },
      {
        click: () => this.app.browserManager.retrieveByIdentifier('settings').show(),
        label: t('file.preferences'),
      },
      { type: 'separator' },
      { label: t('tray.quit'), role: 'quit' },
    ];
  }
}
