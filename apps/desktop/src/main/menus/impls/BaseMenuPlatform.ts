// apps/desktop/src/main/menus/impl/BaseMenuPlatform.ts
import type { MenuItemConstructorOptions } from 'electron';
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
