import { Menu } from 'electron';

export interface MenuOptions {
  showDevItems?: boolean;
  // Other possible configuration items
}

/**
 * Context menu data passed from renderer process
 * Based on Electron's ContextMenuParams
 */
export interface ContextMenuData {
  /** Whether the context is editable (input, textarea, contenteditable) */
  isEditable?: boolean;
  /** URL of the link if right-clicked on a link */
  linkURL?: string;
  /** Media type if right-clicked on media element */
  mediaType?: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin';
  /** Selected text */
  selectionText?: string;
  /** Source URL of media element (image/video/audio src) */
  srcURL?: string;
  /** X coordinate of the context menu */
  x?: number;
  /** Y coordinate of the context menu */
  y?: number;
}

export interface IMenuPlatform {
  /**
   * Build and set application menu
   */
  buildAndSetAppMenu(options?: MenuOptions): Menu;

  /**
   * Build context menu
   */
  buildContextMenu(type: string, data?: ContextMenuData): Menu;

  /**
   * Build tray menu
   */
  buildTrayMenu(): Menu;

  /**
   * Refresh menu
   */
  refresh(options?: MenuOptions): void;
}
