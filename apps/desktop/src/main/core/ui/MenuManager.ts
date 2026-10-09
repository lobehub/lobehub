import type {
  AppMenuNode,
  PopupContextMenuParams,
  PopupContextMenuResult,
  TrayNavigationSnapshot,
} from '@lobechat/electron-client-ipc';
import { type BrowserWindow, Menu, type WebContents } from 'electron';

import type { IMenuPlatform, MenuOptions } from '@/menus';
import { createMenuImpl } from '@/menus';
import { serializeAppMenu } from '@/menus/appMenuSnapshot';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';
import { closeNativeContextMenuPopup, popupNativeContextMenu } from './nativeContextMenu';

// Create logger
const logger = createLogger('core:MenuManager');

export class MenuManager {
  app: App;
  private platformImpl: IMenuPlatform;

  constructor(app: App) {
    logger.debug('Initializing MenuManager');
    this.app = app;
    this.platformImpl = createMenuImpl(app);
  }

  /**
   * Initialize menus (mainly application menu)
   */
  initialize(options?: MenuOptions) {
    logger.info('Initializing application menu');
    this.platformImpl.buildAndSetAppMenu(options);
  }

  /**
   * Build and show context menu
   */
  showContextMenu(type: string, data?: any) {
    logger.debug(`Showing context menu of type: ${type}`);
    const menu = this.platformImpl.buildContextMenu(type, data);
    menu.popup(); // popup must be called in main process
    return { success: true };
  }

  popupContextMenu(
    params: PopupContextMenuParams,
    window: BrowserWindow | null,
  ): Promise<PopupContextMenuResult> {
    logger.debug('Popping up native context menu');
    return popupNativeContextMenu(params, window);
  }

  closePopupContextMenu() {
    logger.debug('Closing native context menu popup');
    closeNativeContextMenuPopup();
    return { success: true };
  }

  getAppMenu(): AppMenuNode[] {
    const menu = Menu.getApplicationMenu();
    if (!menu) return [];

    return serializeAppMenu(menu.items);
  }

  invokeAppMenuItem(
    id: string,
    window: BrowserWindow | null,
    webContents?: WebContents,
  ): { success: boolean } {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item || item.type === 'separator' || item.type === 'submenu') return { success: false };

    item.click(undefined, window ?? undefined, webContents);
    return { success: true };
  }

  /**
   * Build tray menu (usually called by tray manager)
   */
  buildTrayMenu(snapshot?: TrayNavigationSnapshot): Menu {
    logger.debug('Building tray menu');
    return this.platformImpl.buildTrayMenu(snapshot);
  }

  updateDockMenu(snapshot: TrayNavigationSnapshot) {
    this.platformImpl.updateDockMenu?.(snapshot);
  }

  /**
   * Refresh menus
   */
  refreshMenus(options?: MenuOptions) {
    logger.debug('Refreshing all menus');
    this.platformImpl.refresh(options);
    return { success: true };
  }

  /**
   * Rebuild and set application menu (e.g., when toggling dev menu visibility)
   */
  rebuildAppMenu(options?: MenuOptions) {
    logger.debug('Rebuilding application menu');
    this.platformImpl.buildAndSetAppMenu(options);
    return { success: true };
  }
}
