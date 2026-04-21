import type { MainBroadcastEventKey, MainBroadcastParams } from '@lobechat/electron-client-ipc';

import { name } from '@/../../package.json';
import { isMac } from '@/const/env';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';
import type { TrayOptions } from './Tray';
import { Tray } from './Tray';

// Create logger
const logger = createLogger('core:TrayManager');

/**
 * Tray identifier type
 */
export type TrayIdentifiers = 'main';

export class TrayManager {
  app: App;

  /**
   * Store all tray instances
   */
  trays: Map<TrayIdentifiers, Tray> = new Map();

  /**
   * Constructor
   * @param app Application instance
   */
  constructor(app: App) {
    logger.debug('Initialize TrayManager');
    this.app = app;
  }

  /**
   * Initialize all trays
   */
  initializeTrays() {
    logger.debug('Initialize application tray');

    // Initialize main tray
    const mainTray = this.initializeMainTray();

    // Attach the platform-specific context menu built by MenuManager so the
    // tray right-click entries stay in sync with the app menu i18n.
    try {
      mainTray.setMenu(this.app.menuManager.buildTrayMenu());
    } catch (error) {
      logger.error('Failed to attach tray context menu:', error);
    }
  }

  /**
   * Get main tray
   */
  getMainTray() {
    return this.retrieveByIdentifier('main');
  }

  /**
   * Initialize main tray. On macOS we ship a template image (black + alpha)
   * so the system recolors it automatically for light / dark menu bars.
   */
  initializeMainTray() {
    logger.debug('Initialize main tray');
    return this.retrieveOrInitialize({
      iconPath: isMac ? 'trayTemplate.png' : 'tray.png',
      identifier: 'main',
      isTemplateImage: isMac,
      tooltip: name,
    });
  }

  /**
   * Retrieve a tray instance by identifier
   * @param identifier Tray identifier
   */
  retrieveByIdentifier(identifier: TrayIdentifiers) {
    logger.debug(`Retrieving tray by identifier: ${identifier}`);
    return this.trays.get(identifier);
  }

  /**
   * Broadcast a message to all trays
   * @param event Event name
   * @param data Event data
   */
  broadcastToAllTrays = <T extends MainBroadcastEventKey>(
    event: T,
    data: MainBroadcastParams<T>,
  ) => {
    logger.debug(`Broadcasting event ${event} to all trays`);
    this.trays.forEach((tray) => {
      tray.broadcast(event, data);
    });
  };

  /**
   * Broadcast a message to a specific tray
   * @param identifier Tray identifier
   * @param event Event name
   * @param data Event data
   */
  broadcastToTray = <T extends MainBroadcastEventKey>(
    identifier: TrayIdentifiers,
    event: T,
    data: MainBroadcastParams<T>,
  ) => {
    logger.debug(`Broadcasting event ${event} to tray ${identifier}`);
    this.trays.get(identifier)?.broadcast(event, data);
  };

  /**
   * Retrieve or create a tray instance
   * @param options Tray options
   */
  private retrieveOrInitialize(options: TrayOptions) {
    let tray = this.trays.get(options.identifier as TrayIdentifiers);
    if (tray) {
      logger.debug(`Retrieved existing tray: ${options.identifier}`);
      return tray;
    }

    logger.debug(`Creating new tray: ${options.identifier}`);
    tray = new Tray(options, this.app);

    this.trays.set(options.identifier as TrayIdentifiers, tray);

    return tray;
  }

  /**
   * Destroy all trays
   */
  destroyAll() {
    logger.debug('Destroying all trays');
    this.trays.forEach((tray) => {
      tray.destroy();
    });
    this.trays.clear();
  }
}
