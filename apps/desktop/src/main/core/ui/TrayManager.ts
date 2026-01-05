import { MainBroadcastEventKey, MainBroadcastParams } from '@lobechat/electron-client-ipc';
import { nativeTheme } from 'electron';

import { name } from '@/../../package.json';
import { isMac } from '@/const/env';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';
import { Tray, TrayOptions } from './Tray';

// 创建日志记录器
const logger = createLogger('core:TrayManager');

/**
 * 托盘标识符类型
 */
export type TrayIdentifiers = 'main';

export class TrayManager {
  app: App;

  /**
   * 存储所有托盘实例
   */
  trays: Map<TrayIdentifiers, Tray> = new Map();

  /**
   * 构造方法
   * @param app 应用实例
   */
  constructor(app: App) {
    logger.debug('初始化 TrayManager');
    this.app = app;
  }

  /**
   * 初始化所有托盘
   */
  initializeTrays() {
    logger.debug('初始化应用托盘');

    // 初始化主托盘
    this.initializeMainTray();
  }

  /**
   * 获取主托盘
   */
  getMainTray() {
    return this.retrieveByIdentifier('main');
  }

  /**
   * 初始化主托盘
   */
  initializeMainTray() {
    logger.debug('初始化主托盘');
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
   * 通过标识符获取托盘实例
   * @param identifier 托盘标识符
   */
  retrieveByIdentifier(identifier: TrayIdentifiers) {
    logger.debug(`通过标识符获取托盘: ${identifier}`);
    return this.trays.get(identifier);
  }

  /**
   * 向所有托盘广播消息
   * @param event 事件名称
   * @param data 事件数据
   */
  broadcastToAllTrays = <T extends MainBroadcastEventKey>(
    event: T,
    data: MainBroadcastParams<T>,
  ) => {
    logger.debug(`向所有托盘广播事件 ${event}`);
    this.trays.forEach((tray) => {
      tray.broadcast(event, data);
    });
  };

  /**
   * 向指定托盘广播消息
   * @param identifier 托盘标识符
   * @param event 事件名称
   * @param data 事件数据
   */
  broadcastToTray = <T extends MainBroadcastEventKey>(
    identifier: TrayIdentifiers,
    event: T,
    data: MainBroadcastParams<T>,
  ) => {
    logger.debug(`向托盘 ${identifier} 广播事件 ${event}`);
    this.trays.get(identifier)?.broadcast(event, data);
  };

  /**
   * 获取或创建托盘实例
   * @param options 托盘选项
   */
  private retrieveOrInitialize(options: TrayOptions) {
    let tray = this.trays.get(options.identifier as TrayIdentifiers);
    if (tray) {
      logger.debug(`获取现有托盘: ${options.identifier}`);
      return tray;
    }

    logger.debug(`创建新托盘: ${options.identifier}`);
    tray = new Tray(options, this.app);

    this.trays.set(options.identifier as TrayIdentifiers, tray);

    return tray;
  }

  /**
   * 销毁所有托盘
   */
  destroyAll() {
    logger.debug('销毁所有托盘');
    this.trays.forEach((tray) => {
      tray.destroy();
    });
    this.trays.clear();
  }
}
