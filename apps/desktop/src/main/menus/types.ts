import { Menu } from 'electron';

export interface MenuOptions {
  showDevItems?: boolean;
  // Other possible configuration items
}

export interface IMenuPlatform {
  /**
   * Build and set application menu
   */
  buildAndSetAppMenu(options?: MenuOptions): Menu;

  /**
   * Build context menu
   */
  buildContextMenu(type: string, data?: any): Menu;

  /**
   * Build tray menu
   */
  buildTrayMenu(): Menu;

  /**
   * Refresh menu
   */
  refresh(options?: MenuOptions): void;
}
