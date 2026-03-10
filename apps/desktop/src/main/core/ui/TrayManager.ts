import { MainBroadcastEventKey, MainBroadcastParams } from '@lobechat/electron-client-ipc';
import { nativeTheme } from 'electron';

import { name } from '@/../../package.json';
import { isMac } from '@/const/env';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';
import { Tray, TrayOptions } from './Tray';

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
    this.initializeMainTray();
  }

  /**
   * Get main tray
   */
  getMainTray() {
    return this.retrieveByIdentifier('main');
  }

  /**
   * Initialize main tray
   */
  initializeMainTray() {
    logger.debug('Initialize main tray');
    return this.retrieveOrInitialize({
      iconPath: isMac
        ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
          ? 'tray-dark.png'
          : 'tray-light.png'
        : 'tray.png',
      identifier: 'main', // Use app icon, ensure this file exists in resources directory
      tooltip: name, // Can use app.getName() or localized string
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
