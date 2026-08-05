import type { PopupContextMenuParams, PopupContextMenuResult } from '@lobechat/electron-client-ipc';
import { BrowserWindow } from 'electron';

import { getIpcContext } from '@/utils/ipc';

import { ControllerModule, IpcMethod } from './index';

export default class MenuController extends ControllerModule {
  static override readonly groupName = 'menu';
  /**
   * Refresh menu
   */
  @IpcMethod()
  refreshAppMenu() {
    // Note: May need to decide whether to allow renderer process to refresh all menus based on specific circumstances
    return this.app.menuManager.refreshMenus();
  }

  /**
   * Show context menu
   */
  @IpcMethod()
  showContextMenu(params: { data?: any; type: string }) {
    return this.app.menuManager.showContextMenu(params.type, params.data);
  }

  /**
   * Set development menu visibility
   */
  @IpcMethod()
  setDevMenuVisibility(visible: boolean) {
    // Call MenuManager method to rebuild application menu
    return this.app.menuManager.rebuildAppMenu({ showDevItems: visible });
  }

  @IpcMethod()
  popupContextMenu(params: PopupContextMenuParams): Promise<PopupContextMenuResult> {
    const context = getIpcContext();
    const window = context ? BrowserWindow.fromWebContents(context.sender) : null;
    return this.app.menuManager.popupContextMenu(params, window);
  }

  @IpcMethod()
  closePopupContextMenu() {
    return this.app.menuManager.closePopupContextMenu();
  }
}
