import { join } from 'node:path';

import type { MainBroadcastEventKey, MainBroadcastParams } from '@lobechat/electron-client-ipc';
import type {
  DisplayBalloonOptions,
  MenuItemConstructorOptions} from 'electron';
import {
  app,
  Menu,
  nativeImage,
  Tray as ElectronTray,
} from 'electron';

import { resourcesDir } from '@/const/dir';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';

// Create logger
const logger = createLogger('core:Tray');

export interface TrayOptions {
  /**
   * Tray icon path (relative to resource directory)
   */
  iconPath: string;

  /**
   * Tray identifier
   */
  identifier: string;

  /**
   * Tray tooltip text
   */
  tooltip?: string;
}

export class Tray {
  private app: App;

  /**
   * Internal Electron tray
   */
  private _tray?: ElectronTray;

  /**
   * Identifier
   */
  identifier: string;

  /**
   * Options when created
   */
  options: TrayOptions;

  /**
   * Get tray instance
   */
  get tray() {
    return this.retrieveOrInitialize();
  }

  /**
   * Construct tray object
   * @param options Tray options
   * @param application App instance
   */
  constructor(options: TrayOptions, application: App) {
    logger.debug(`Creating tray instance: ${options.identifier}`);
    logger.debug(`Tray options: ${JSON.stringify(options)}`);
    this.app = application;
    this.identifier = options.identifier;
    this.options = options;

    // Initialize
    this.retrieveOrInitialize();
  }

  /**
   * Initialize tray
   */
  retrieveOrInitialize() {
    // If tray already exists and is not destroyed, return it
    if (this._tray) {
      logger.debug(`[${this.identifier}] Returning existing tray instance`);
      return this._tray;
    }

    const { iconPath, tooltip } = this.options;

    // Load tray icon
    logger.info(`Creating new tray instance: ${this.identifier}`);
    const iconFile = join(resourcesDir, iconPath);
    logger.debug(`[${this.identifier}] Loading icon: ${iconFile}`);

    try {
      const icon = nativeImage.createFromPath(iconFile);
      this._tray = new ElectronTray(icon);

      // Set tooltip
      if (tooltip) {
        logger.debug(`[${this.identifier}] Setting tooltip: ${tooltip}`);
        this._tray.setToolTip(tooltip);
      }

      // Set default context menu
      this.setContextMenu();

      // Set click event
      this._tray.on('click', () => {
        logger.debug(`[${this.identifier}] Tray clicked`);
        this.onClick();
      });

      logger.debug(`[${this.identifier}] Tray instance created successfully`);
      return this._tray;
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to create tray:`, error);
      throw error;
    }
  }

  /**
   * Set tray context menu
   * @param template Menu template, if not provided default template will be used
   */
  setContextMenu(template?: MenuItemConstructorOptions[]) {
    logger.debug(`[${this.identifier}] Setting tray context menu`);

    // If no template provided, use default menu
    const defaultTemplate: MenuItemConstructorOptions[] = template || [
      {
        click: () => {
          logger.debug(`[${this.identifier}] Menu item "Show Main Window" clicked`);
          this.app.browserManager.showMainWindow();
        },
        label: 'Show Main Window',
      },
      { type: 'separator' },
      {
        click: () => {
          logger.debug(`[${this.identifier}] Menu item "Quit" clicked`);
          app.quit();
        },
        label: 'Quit',
      },
    ];

    const contextMenu = Menu.buildFromTemplate(defaultTemplate);
    this._tray?.setContextMenu(contextMenu);
    logger.debug(`[${this.identifier}] Tray context menu has been set`);
  }

  /**
   * Handle tray click event
   */
  onClick() {
    logger.debug(`[${this.identifier}] Handling tray click event`);
    const mainWindow = this.app.browserManager.getMainWindow();

    if (mainWindow) {
      if (mainWindow.browserWindow.isVisible() && mainWindow.browserWindow.isFocused()) {
        logger.debug(`[${this.identifier}] Main window is visible and focused, hiding it now`);
        mainWindow.hide();
      } else {
        logger.debug(`[${this.identifier}] Showing and focusing main window`);
        mainWindow.show();
        mainWindow.browserWindow.focus();
      }
    }
  }

  /**
   * Update tray icon
   * @param iconPath New icon path (relative to resource directory)
   */
  updateIcon(iconPath: string) {
    logger.debug(`[${this.identifier}] Updating icon: ${iconPath}`);
    try {
      const iconFile = join(resourcesDir, iconPath);
      const icon = nativeImage.createFromPath(iconFile);
      this._tray?.setImage(icon);
      this.options.iconPath = iconPath;
      logger.debug(`[${this.identifier}] Icon updated successfully`);
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to update icon:`, error);
    }
  }

  /**
   * Update tooltip text
   * @param tooltip New tooltip text
   */
  updateTooltip(tooltip: string) {
    logger.debug(`[${this.identifier}] Updating tooltip: ${tooltip}`);
    this._tray?.setToolTip(tooltip);
    this.options.tooltip = tooltip;
  }

  /**
   * Display balloon notification (only supported on Windows)
   * @param options Balloon options
   */
  displayBalloon(options: DisplayBalloonOptions) {
    if (process.platform === 'win32' && this._tray) {
      logger.debug(
        `[${this.identifier}] Displaying balloon notification: ${JSON.stringify(options)}`,
      );
      this._tray.displayBalloon(options);
    } else {
      logger.debug(`[${this.identifier}] Balloon notification is only supported on Windows`);
    }
  }

  /**
   * Broadcast event
   */
  broadcast = <T extends MainBroadcastEventKey>(channel: T, data?: MainBroadcastParams<T>) => {
    logger.debug(`Broadcasting to tray ${this.identifier}, channel: ${channel}`);
    // Can forward message to main window through App instance's browserManager
    this.app.browserManager.getMainWindow()?.broadcast(channel, data);
  };

  /**
   * Destroy tray instance
   */
  destroy() {
    logger.debug(`Destroying tray instance: ${this.identifier}`);
    if (this._tray) {
      this._tray.destroy();
      this._tray = undefined;
    }
  }
}
