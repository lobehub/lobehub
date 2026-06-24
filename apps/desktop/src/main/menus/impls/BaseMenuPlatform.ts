// apps/desktop/src/main/menus/impl/BaseMenuPlatform.ts
import type { BaseWindow, MenuItemConstructorOptions } from 'electron';
import { BrowserWindow } from 'electron';

import type { App } from '@/core/App';
import ZoomService, { type ZoomAction } from '@/services/zoomSrv';

export abstract class BaseMenuPlatform {
  protected app: App;

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
