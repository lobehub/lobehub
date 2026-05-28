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
    return {
      accelerator,
      click: (_item, win) => {
        const target = win instanceof BrowserWindow ? win : BrowserWindow.getFocusedWindow();
        if (!target) return;
        this.app.getService(ZoomService).apply(action, target.webContents);
      },
      label,
    };
  }
}
