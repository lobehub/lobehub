import { ElectronIPCEventHandler, ElectronIPCServer } from '@lobechat/electron-server-ipc';
import { app, nativeTheme, protocol } from 'electron';
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { macOS, windows } from 'electron-is';
import os from 'node:os';
import { join } from 'node:path';

import { name } from '@/../../package.json';
import { buildDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { ELECTRON_BE_PROTOCOL_SCHEME } from '@/const/protocol';
import { IControlModule } from '@/controllers';
import AuthCtr from '@/controllers/AuthCtr';
import {
  astSearchDetectors,
  contentSearchDetectors,
  fileSearchDetectors,
} from '@/modules/toolDetectors';
import { IServiceModule } from '@/services';
import { createLogger } from '@/utils/logger';

import { BrowserManager } from './browser/BrowserManager';
import { I18nManager } from './infrastructure/I18nManager';
import { IoCContainer } from './infrastructure/IoCContainer';
import { ProtocolManager } from './infrastructure/ProtocolManager';
import { RendererUrlManager } from './infrastructure/RendererUrlManager';
import { StaticFileServerManager } from './infrastructure/StaticFileServerManager';
import { StoreManager } from './infrastructure/StoreManager';
import { ToolDetectorManager } from './infrastructure/ToolDetectorManager';
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
  browserManager: BrowserManager;
  menuManager: MenuManager;
  i18n: I18nManager;
  storeManager: StoreManager;
  updaterManager: UpdaterManager;
  shortcutManager: ShortcutManager;
  trayManager: TrayManager;
  staticFileServerManager: StaticFileServerManager;
  protocolManager: ProtocolManager;
  rendererUrlManager: RendererUrlManager;
  toolDetectorManager: ToolDetectorManager;
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

    this.rendererUrlManager = new RendererUrlManager();
    protocol.registerSchemesAsPrivileged([
      {
        privileges: {
          allowServiceWorkers: true,
          corsEnabled: true,
          secure: true,
          standard: true,
          supportFetchAPI: true,
        },
        scheme: ELECTRON_BE_PROTOCOL_SCHEME,
      },
      this.rendererUrlManager.protocolScheme,
    ]);

    // load controllers
    const controllers: IControlModule[] = importAll(
      import.meta.glob('@/controllers/*Ctr.ts', { eager: true }),
    );

    logger.debug(`Loading ${controllers.length} controllers`);
    controllers.forEach((controller) => this.addController(controller));

    // load services
    const services: IServiceModule[] = importAll(
      import.meta.glob('@/services/*Srv.ts', { eager: true }),
    );

    logger.debug(`Loading ${services.length} services`);
    services.forEach((service) => this.addService(service));

    this.initializeServerIpcEvents();

    this.i18n = new I18nManager(this);
    this.browserManager = new BrowserManager(this);
    this.menuManager = new MenuManager(this);
    this.updaterManager = new UpdaterManager(this);
    this.shortcutManager = new ShortcutManager(this);
    this.trayManager = new TrayManager(this);
    this.staticFileServerManager = new StaticFileServerManager(this);
    this.protocolManager = new ProtocolManager(this);
    this.toolDetectorManager = new ToolDetectorManager(this);

    // Register built-in tool detectors
    this.registerBuiltinToolDetectors();

    // Configure renderer loading strategy (dev server vs static export)
    // should register before app ready
    this.rendererUrlManager.configureRendererLoader();

    // initialize protocol handlers
    this.protocolManager.initialize();

    // Unified handling of before-quit event
    app.on('before-quit', this.handleBeforeQuit);

    // Initialize theme mode from store
    this.initializeThemeMode();

    logger.info('App initialization completed');
  }

  /**
   * Initialize nativeTheme.themeSource from stored themeMode preference
   * This allows nativeTheme.shouldUseDarkColors to be used consistently everywhere
   */
  private initializeThemeMode() {
    let themeMode = this.storeManager.get('themeMode');

    // Migrate legacy 'auto' value to 'system' (nativeTheme.themeSource doesn't accept 'auto')
    if (Object.is(themeMode, 'auto')) {
      themeMode = 'system';
      this.storeManager.set('themeMode', themeMode);
      logger.info(`Migrated legacy theme mode 'auto' to 'system'`);
    }

    if (themeMode) {
      nativeTheme.themeSource = themeMode;
      logger.debug(
        `Theme mode initialized to: ${themeMode} (themeSource: ${nativeTheme.themeSource})`,
      );
    }
  }

  /**
   * Register built-in tool detectors for content search and file search
   */
  private registerBuiltinToolDetectors() {
    logger.debug('Registering built-in tool detectors');

    // Register content search tools (rg, ag, grep)
    for (const detector of contentSearchDetectors) {
      this.toolDetectorManager.register(detector, 'content-search');
    }

    // Register AST-based code search tools (ast-grep)
    for (const detector of astSearchDetectors) {
      this.toolDetectorManager.register(detector, 'ast-search');
    }

    // Register file search tools (mdfind, fd, find)
    for (const detector of fileSearchDetectors) {
      this.toolDetectorManager.register(detector, 'file-search');
    }

    logger.info(
      `Registered ${this.toolDetectorManager.getRegisteredTools().length} tool detectors`,
    );
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
   * @param urlType Protocol URL type (e.g., 'plugin')
   * @param action Action type (e.g., 'install')
   * @param data Parsed protocol data
   * @returns Whether successfully handled
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
      return result !== false; // Assume controller returning false indicates handling failure
    } catch (error) {
      logger.error(`Error handling protocol request ${key}:`, error);
      return false;
    }
  }

  private onActivate = () => {
    logger.debug('Application activated');
    this.browserManager.showMainWindow();

    // Trigger proactive token refresh on app activation (respects 6-hour interval)
    const authCtr = this.getController(AuthCtr);
    if (authCtr) {
      authCtr.onAppActivate().catch((error) => {
        logger.error('Error during app activation token refresh:', error);
      });
    }
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

    await this.installReactDevtools();

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

  /**
   * Development only: install React DevTools extension into Electron's devtools.
   */
  private installReactDevtools = async () => {
    if (!isDev) return;

    try {
      const name = await installExtension(REACT_DEVELOPER_TOOLS);

      logger.info(`Installed DevTools extension: ${name}`);
    } catch (error) {
      logger.warn('Failed to install React DevTools extension', error);
    }
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
  private ipcServerEventMap: IPCEventMap = new Map();
  shortcutMethodMap: ShortcutMethodMap = new Map();
  protocolHandlerMap: ProtocolHandlerMap = new Map();

  private addController = (ControllerClass: IControlModule) => {
    const controller = new ControllerClass(this);
    this.controllers.set(ControllerClass, controller);

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
   * Build renderer URL for dev/prod.
   */
  async buildRendererUrl(path: string): Promise<string> {
    return this.rendererUrlManager.buildRendererUrl(path);
  }

  private initializeServerIpcEvents() {
    logger.debug('Initializing IPC server events');
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

  // Add before-quit handler function
  private handleBeforeQuit = () => {
    logger.info('Application is preparing to quit');
    this.isQuiting = true;

    // Destroy tray
    if (process.platform === 'win32') {
      this.trayManager.destroyAll();
    }

    // Execute cleanup operations
    this.staticFileServerManager.destroy();
  };
}
