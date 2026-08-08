// apps/desktop/src/main/menus/impl/BaseMenuPlatform.ts
import type { BaseWindow, MenuItemConstructorOptions } from 'electron';
import { BrowserWindow } from 'electron';

import type { App } from '@/core/App';
import ZoomService, { type ZoomAction } from '@/services/zoomSrv';

export abstract class BaseMenuPlatform {
  protected app: App;
  private readonly devToolsWindows = new Map<BrowserWindow, BrowserWindow>();

  constructor(app: App) {
    this.app = app;
  }

  protected buildZoomMenuItem(
    action: ZoomAction,
    label: string,
    accelerator: string,
  ): MenuItemConstructorOptions {
    return this.buildZoomMenuItemOption(action, label, accelerator);
  }

  protected buildZoomMenuItems(
    action: ZoomAction,
    label: string,
    accelerator: string,
    alternateAccelerators: string[],
  ): MenuItemConstructorOptions[] {
    return [
      this.buildZoomMenuItemOption(action, label, accelerator),
      ...alternateAccelerators.map((alternateAccelerator) =>
        this.buildZoomMenuItemOption(action, label, alternateAccelerator, false),
      ),
    ];
  }

  protected buildDevToolsMenuItem(label: string, accelerator?: string): MenuItemConstructorOptions {
    return {
      accelerator,
      click: (_item, win) => {
        this.toggleOrFocusDevTools(win);
      },
      label,
    };
  }

  protected closeFocusedTabOrWindow(targetWindow?: BaseWindow | null): void {
    const focused =
      targetWindow && 'webContents' in targetWindow
        ? (targetWindow as BrowserWindow)
        : BrowserWindow.getFocusedWindow();
    if (!focused) return;

    if (focused.webContents.isDevToolsOpened()) {
      focused.webContents.closeDevTools();
      return;
    }

    const mainWindow = this.app.browserManager.getMainWindow();
    if (focused === mainWindow.browserWindow) {
      mainWindow.broadcast('closeCurrentTabOrWindow');
    } else {
      focused.close();
    }
  }

  private toggleOrFocusDevTools(targetWindow?: BaseWindow | null): void {
    const target =
      targetWindow && 'webContents' in targetWindow
        ? (targetWindow as BrowserWindow)
        : BrowserWindow.getFocusedWindow();
    if (!target) {
      this.closeFocusedDefaultDevTools();
      return;
    }

    const owner = this.findManagedDevToolsOwner(target);
    if (owner) {
      this.closeManagedDevTools(owner);
      return;
    }

    const managedDevToolsWindow = this.devToolsWindows.get(target);
    if (managedDevToolsWindow && !managedDevToolsWindow.isDestroyed()) {
      if (managedDevToolsWindow.isFocused() || target.webContents.isDevToolsFocused()) {
        this.closeManagedDevTools(target);
        return;
      }

      this.focusBrowserWindow(managedDevToolsWindow);
      return;
    }

    if (this.closeFocusedDefaultDevTools()) return;

    if (target.webContents.isDevToolsOpened()) {
      if (target.webContents.isDevToolsFocused()) {
        target.webContents.closeDevTools();
        return;
      }

      this.replaceDefaultDevToolsWithManagedWindow(target);
      return;
    }

    this.openManagedDevTools(target);
  }

  private closeFocusedDefaultDevTools(): boolean {
    const owner = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.isDevToolsOpened() && window.webContents.isDevToolsFocused(),
    );

    if (!owner) return false;

    owner.webContents.closeDevTools();
    return true;
  }

  private closeManagedDevTools(target: BrowserWindow): void {
    const devToolsWindow = this.devToolsWindows.get(target);
    this.devToolsWindows.delete(target);

    if (!target.isDestroyed() && target.webContents.isDevToolsOpened()) {
      target.webContents.closeDevTools();
    }

    if (devToolsWindow && !devToolsWindow.isDestroyed()) {
      devToolsWindow.close();
    }
  }

  private findManagedDevToolsOwner(devToolsWindow: BrowserWindow): BrowserWindow | undefined {
    for (const [owner, managedDevToolsWindow] of this.devToolsWindows) {
      if (managedDevToolsWindow === devToolsWindow) return owner;
    }
  }

  private focusBrowserWindow(browserWindow: BrowserWindow): void {
    if (browserWindow.isMinimized()) browserWindow.restore();
    browserWindow.show();
    browserWindow.focus();
  }

  private openManagedDevTools(target: BrowserWindow): void {
    if (target.isDestroyed()) return;

    const devToolsWindow = new BrowserWindow({
      autoHideMenuBar: true,
      height: 800,
      show: false,
      title: 'Developer Tools',
      width: 1200,
    });

    this.devToolsWindows.set(target, devToolsWindow);

    devToolsWindow.on('closed', () => {
      if (this.devToolsWindows.get(target) !== devToolsWindow) return;
      this.devToolsWindows.delete(target);
      if (!target.isDestroyed() && target.webContents.isDevToolsOpened()) {
        target.webContents.closeDevTools();
      }
    });

    target.on('closed', () => {
      this.devToolsWindows.delete(target);
      if (!devToolsWindow.isDestroyed()) devToolsWindow.close();
    });

    target.webContents.setDevToolsWebContents(devToolsWindow.webContents);
    target.webContents.openDevTools({ activate: true, mode: 'detach' });
    this.focusBrowserWindow(devToolsWindow);
  }

  private replaceDefaultDevToolsWithManagedWindow(target: BrowserWindow): void {
    target.webContents.closeDevTools();

    setTimeout(() => {
      if (target.isDestroyed()) return;
      this.openManagedDevTools(target);
    }, 0);
  }

  private buildZoomMenuItemOption(
    action: ZoomAction,
    label: string,
    accelerator: string,
    visible = true,
  ): MenuItemConstructorOptions {
    return {
      accelerator,
      click: (_item, win) => {
        const target = win instanceof BrowserWindow ? win : BrowserWindow.getFocusedWindow();
        if (!target) return;
        this.app.getService(ZoomService).apply(action, target.webContents);
      },
      label,
      visible,
    };
  }
}
