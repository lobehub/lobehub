import { ElectronIPCEventHandler, ElectronIPCServer } from '@lobechat/electron-server-ipc';
import { Session, app, ipcMain, protocol } from 'electron';
import { macOS, windows } from 'electron-is';
import { pathExistsSync, remove } from 'fs-extra';
import os from 'node:os';
import { join } from 'node:path';

import { name } from '@/../../package.json';
import { buildDir, LOCAL_DATABASE_DIR, nextStandaloneDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { IControlModule } from '@/controllers';
import { IServiceModule } from '@/services';
import { IpcClientEventSender } from '@/types/ipcClientEvent';
import { createLogger } from '@/utils/logger';
import { CustomRequestHandler, createHandler } from '@/utils/next-electron-rsc';

import { BrowserManager } from './browser/BrowserManager';
import { I18nManager } from './infrastructure/I18nManager';
import { IoCContainer } from './infrastructure/IoCContainer';
import { ProtocolManager } from './infrastructure/ProtocolManager';
import { StaticFileServerManager } from './infrastructure/StaticFileServerManager';
import { StoreManager } from './infrastructure/StoreManager';
import { UpdaterManager } from './infrastructure/UpdaterManager';
import { MenuManager } from './ui/MenuManager';
import { ShortcutManager } from './ui/ShortcutManager';
import { TrayManager } from './ui/TrayManager';

const logger = createLogger('core:App');

export type IPCEventMap = Map<string, { controller: any; methodName: string }>;
export type ShortcutMethodMap = Map<string, () => Promise<void>>;
export type ProtocolHandlerMap = Map<string, { controller: any; methodName: string }>;

type Class<T> = new (...args: any[]) => T;

const importAll = (r: any) => Object.values(r).map((v: any) => v.default);

export class App {
  nextServerUrl = 'http://localhost:3015';

  browserManager: BrowserManager;
  menuManager: MenuManager;
  i18n: I18nManager;
  storeManager: StoreManager;
  updaterManager: UpdaterManager;
  shortcutManager: ShortcutManager;
  trayManager: TrayManager;
  staticFileServerManager: StaticFileServerManager;
  protocolManager: ProtocolManager;
  chromeFlags: string[] = ['OverlayScrollbar', 'FluentOverlayScrollbar', 'FluentScrollbar'];

  /**
   * whether app is in quiting
   */
  isQuiting: boolean = false;

  get appStoragePath() {
    const storagePath = this.storeManager.get('storagePath');

    if (!storagePath) {
      throw new Error('Storage path not found in store');
    }

    return storagePath;
  }

  constructor() {
    logger.info('----------------------------------------------');
    // Log system information
    logger.info(`  OS: ${os.platform()} (${os.arch()})`);
    logger.info(` CPU: ${os.cpus().length} cores`);
    logger.info(` RAM: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`);
    logger.info(`PATH: ${app.getAppPath()}`);
    logger.info(` lng: ${app.getLocale()}`);
    logger.info('----------------------------------------------');
    logger.info('Starting LobeHub...');

    logger.debug('Initializing App');
    // Initialize store manager
    this.storeManager = new StoreManager(this);

    // load controllers
    const controllers: IControlModule[] = importAll(
      (import.meta as any).glob('@/controllers/*Ctr.ts', { eager: true }),
    );

    logger.debug(`Loading ${controllers.length} controllers`);
    controllers.forEach((controller) => this.addController(controller));

    // load services
    const services: IServiceModule[] = importAll(
      (import.meta as any).glob('@/services/*Srv.ts', { eager: true }),
    );

    logger.debug(`Loading ${services.length} services`);
    services.forEach((service) => this.addService(service));

    this.initializeIPCEvents();

    this.i18n = new I18nManager(this);
    this.browserManager = new BrowserManager(this);
    this.menuManager = new MenuManager(this);
    this.updaterManager = new UpdaterManager(this);
    this.shortcutManager = new ShortcutManager(this);
    this.trayManager = new TrayManager(this);
    this.staticFileServerManager = new StaticFileServerManager(this);
    this.protocolManager = new ProtocolManager(this);

    // register the schema to interceptor url
    // it should register before app ready
    this.registerNextHandler();

    // initialize protocol handlers
    this.protocolManager.initialize();

    // 统一处理 before-quit 事件
    app.on('before-quit', this.handleBeforeQuit);

    logger.info('App initialization completed');
  }

  bootstrap = async () => {
    logger.info('Bootstrapping application');
    // make single instance
    const isSingle = app.requestSingleInstanceLock();
    if (!isSingle) {
      logger.info('Another instance is already running, exiting');
      app.exit(0);
    }

    this.initDevBranding();

    // Clean up stale database lock file before starting IPC server
    await this.cleanupDatabaseLock();

    //  ==============
    await this.ipcServer.start();
    logger.debug('IPC server started');

    // Initialize app
    await this.makeAppReady();

    // Initialize i18n. Note: app.getLocale() must be called after app.whenReady() to get the correct value
    await this.i18n.init();
    this.menuManager.initialize();

    // Initialize static file manager
    await this.staticFileServerManager.initialize();

    // Initialize global shortcuts: globalShortcut must be called after app.whenReady()
    this.shortcutManager.initialize();

    this.browserManager.initializeBrowsers();

    // Initialize tray manager
    if (process.platform === 'win32') {
      this.trayManager.initializeTrays();
    }

    // Initialize updater manager
    await this.updaterManager.initialize();

    // Set global application exit state
    this.isQuiting = false;

    app.on('window-all-closed', () => {
      if (windows()) {
        logger.info('All windows closed, quitting application (Windows)');
        app.quit();
      }
    });

    app.on('activate', this.onActivate);

    // Process any pending protocol URLs after everything is ready
    await this.protocolManager.processPendingUrls();

    logger.info('Application bootstrap completed');
  };

  getService<T>(serviceClass: Class<T>): T {
    return this.services.get(serviceClass);
  }

  getController<T>(controllerClass: Class<T>): T {
    return this.controllers.get(controllerClass);
  }

  /**
   * Handle protocol request by dispatching to registered handlers
   * @param urlType 协议URL类型 (如: 'plugin')
   * @param action 操作类型 (如: 'install')
   * @param data 解析后的协议数据
   * @returns 是否成功处理
   */
  async handleProtocolRequest(urlType: string, action: string, data: any): Promise<boolean> {
    const key = `${urlType}:${action}`;
    const handler = this.protocolHandlerMap.get(key);

    if (!handler) {
      logger.warn(`No protocol handler found for ${key}`);
      return false;
    }

    try {
      logger.debug(`Dispatching protocol request ${key} to controller`);
      const result = await handler.controller[handler.methodName](data);
      return result !== false; // 假设控制器返回 false 表示处理失败
    } catch (error) {
      logger.error(`Error handling protocol request ${key}:`, error);
      return false;
    }
  }

  private onActivate = () => {
    logger.debug('Application activated');
    this.browserManager.showMainWindow();
  };

  /**
   * Call beforeAppReady method on all controllers before the application is ready
   */
  private makeAppReady = async () => {
    logger.debug('Preparing application ready state');
    this.controllers.forEach((controller) => {
      if (typeof controller.beforeAppReady === 'function') {
        try {
          controller.beforeAppReady();
        } catch (error) {
          logger.error(`Error in controller.beforeAppReady:`, error);
          console.error(`[App] Error in controller.beforeAppReady:`, error);
        }
      }
    });

    // refs: https://github.com/lobehub/lobe-chat/pull/7883
    // https://github.com/electron/electron/issues/46538#issuecomment-2808806722
    app.commandLine.appendSwitch('gtk-version', '3');

    app.commandLine.appendSwitch('enable-features', this.chromeFlags.join(','));

    logger.debug('Waiting for app to be ready');
    await app.whenReady();
    logger.debug('Application ready');

    this.controllers.forEach((controller) => {
      if (typeof controller.afterAppReady === 'function') {
        try {
          controller.afterAppReady();
        } catch (error) {
          logger.error(`Error in controller.afterAppReady:`, error);
          console.error(`[App] Error in controller.beforeAppReady:`, error);
        }
      }
    });
    logger.info('Application ready state completed');
  };

  // ============= helper ============= //

  /**
   * all controllers in app
   */
  private controllers = new Map<Class<any>, any>();
  /**
   * all services in app
   */
  private services = new Map<Class<any>, any>();

  private ipcServer: ElectronIPCServer;
  /**
   * events dispatched from webview layer
   */
  private ipcClientEventMap: IPCEventMap = new Map();
  private ipcServerEventMap: IPCEventMap = new Map();
  shortcutMethodMap: ShortcutMethodMap = new Map();
  protocolHandlerMap: ProtocolHandlerMap = new Map();

  /**
   * use in next router interceptor in prod browser render
   */
  nextInterceptor: (params: { session: Session }) => () => void;

  /**
   * Collection of unregister functions for custom request handlers
   */
  private customHandlerUnregisterFns: Array<() => void> = [];

  /**
   * Function to register custom request handler
   */
  private registerCustomHandlerFn?: (handler: CustomRequestHandler) => () => void;

  /**
   * Register custom request handler
   * @param handler Custom request handler function
   * @returns Function to unregister the handler
   */
  registerRequestHandler = (handler: CustomRequestHandler): (() => void) => {
    if (!this.registerCustomHandlerFn) {
      logger.warn('Custom request handler registration is not available');
      return () => {};
    }

    logger.debug('Registering custom request handler');
    const unregisterFn = this.registerCustomHandlerFn(handler);
    this.customHandlerUnregisterFns.push(unregisterFn);

    return () => {
      unregisterFn();
      const index = this.customHandlerUnregisterFns.indexOf(unregisterFn);
      if (index !== -1) {
        this.customHandlerUnregisterFns.splice(index, 1);
      }
    };
  };

  /**
   * Unregister all custom request handlers
   */
  unregisterAllRequestHandlers = () => {
    this.customHandlerUnregisterFns.forEach((unregister) => unregister());
    this.customHandlerUnregisterFns = [];
  };

  private addController = (ControllerClass: IControlModule) => {
    const controller = new ControllerClass(this);
    this.controllers.set(ControllerClass, controller);

    IoCContainer.controllers.get(ControllerClass)?.forEach((event) => {
      if (event.mode === 'client') {
        // Store all objects from event decorator in ipcClientEventMap
        this.ipcClientEventMap.set(event.name, {
          controller,
          methodName: event.methodName,
        });
      }

      if (event.mode === 'server') {
        // Store all objects from event decorator in ipcServerEventMap
        this.ipcServerEventMap.set(event.name, {
          controller,
          methodName: event.methodName,
        });
      }
    });

    IoCContainer.shortcuts.get(ControllerClass)?.forEach((shortcut) => {
      this.shortcutMethodMap.set(shortcut.name, async () => {
        controller[shortcut.methodName]();
      });
    });

    IoCContainer.protocolHandlers.get(ControllerClass)?.forEach((handler) => {
      const key = `${handler.urlType}:${handler.action}`;
      this.protocolHandlerMap.set(key, {
        controller,
        methodName: handler.methodName,
      });
    });
  };

  private addService = (ServiceClass: IServiceModule) => {
    const service = new ServiceClass(this);
    this.services.set(ServiceClass, service);
  };

  private initDevBranding = () => {
    if (!isDev) return;

    logger.debug('Setting up dev branding');
    app.setName('lobehub-desktop-dev');
    if (macOS()) {
      app.dock!.setIcon(join(buildDir, 'icon-dev.png'));
    }
  };

  /**
   * Clean up stale database lock file from previous crashes or abnormal exits
   */
  private cleanupDatabaseLock = async () => {
    try {
      const dbPath = join(this.appStoragePath, LOCAL_DATABASE_DIR);
      const lockPath = `${dbPath}.lock`;

      if (pathExistsSync(lockPath)) {
        logger.info(`Cleaning up stale database lock file: ${lockPath}`);
        await remove(lockPath);
        logger.info('Database lock file removed successfully');
      } else {
        logger.debug('No database lock file found, skipping cleanup');
      }
    } catch (error) {
      logger.error('Failed to cleanup database lock file:', error);
      // Non-fatal error, allow application to continue
    }
  };

  private registerNextHandler() {
    logger.debug('Registering Next.js handler');
    const handler = createHandler({
      debug: true,
      localhostUrl: this.nextServerUrl,
      protocol,
      standaloneDir: nextStandaloneDir,
    });

    // Log output based on development or production mode
    if (isDev) {
      logger.info(
        `Development mode: Custom request handler enabled, but Next.js interception disabled`,
      );
    } else {
      logger.info(
        `Production mode: ${this.nextServerUrl} will be intercepted to ${nextStandaloneDir}`,
      );
    }

    this.nextInterceptor = handler.createInterceptor;

    // Save custom handler registration function
    if (handler.registerCustomHandler) {
      this.registerCustomHandlerFn = handler.registerCustomHandler;
      logger.debug('Custom request handler registration is available');
    } else {
      logger.warn('Custom request handler registration is not available');
    }
  }

  private initializeIPCEvents() {
    logger.debug('Initializing IPC events');
    // Register batch controller client events for render side consumption
    this.ipcClientEventMap.forEach((eventInfo, key) => {
      const { controller, methodName } = eventInfo;

      ipcMain.handle(key, async (e, data) => {
        // 从 WebContents 获取对应的 BrowserWindow id
        const senderIdentifier = this.browserManager.getIdentifierByWebContents(e.sender);
        try {
          return await controller[methodName](data, {
            identifier: senderIdentifier,
          } as IpcClientEventSender);
        } catch (error) {
          logger.error(`Error handling IPC event ${key}:`, error);
          return { error: error.message };
        }
      });
    });

    // Batch register server events from controllers for next server consumption
    const ipcServerEvents = {} as ElectronIPCEventHandler;

    this.ipcServerEventMap.forEach((eventInfo, key) => {
      const { controller, methodName } = eventInfo;

      ipcServerEvents[key] = async (payload) => {
        try {
          return await controller[methodName](payload);
        } catch (error) {
          return { error: error.message };
        }
      };
    });

    this.ipcServer = new ElectronIPCServer(name, ipcServerEvents);
  }

  // 新增 before-quit 处理函数
  private handleBeforeQuit = () => {
    logger.info('Application is preparing to quit');
    this.isQuiting = true;

    // 销毁托盘
    if (process.platform === 'win32') {
      this.trayManager.destroyAll();
    }

    // 执行清理操作
    this.staticFileServerManager.destroy();
    this.unregisterAllRequestHandlers();
  };
}
