import os from 'node:os';
import path from 'node:path';

import type { ElectronIPCEventHandler } from '@lobechat/electron-server-ipc';
import { ElectronIPCServer } from '@lobechat/electron-server-ipc';
import { app, nativeTheme, protocol } from 'electron';
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import * as electronIs from 'electron-is';

import { name } from '@/../../package.json';
import { binDir, buildDir } from '@/const/dir';
import { isDev } from '@/const/env';
import type { IControlModule } from '@/controllers';
import AuthCtr from '@/controllers/AuthCtr';
import {
  astSearchBinaries,
  type BinaryCategory,
  type BinarySpec,
  browserAutomationBinaries,
  cliAgentBinaries,
  contentSearchBinaries,
  fileSearchBinaries,
  runtimeEnvironmentBinaries,
} from '@/modules/binaries';
import { generateCliWrapper, getCliWrapperDir } from '@/modules/cliEmbedding';
import { ScreenCaptureManager } from '@/modules/screenCapture/ScreenCaptureManager';
import type { IServiceModule } from '@/services';
import { createLogger } from '@/utils/logger';

import { BrowserManager } from './browser/BrowserManager';
import { backendProxyProtocolManager } from './infrastructure/BackendProxyProtocolManager';
import { BinaryManager } from './infrastructure/BinaryManager';
import { I18nManager } from './infrastructure/I18nManager';
import { IoCContainer } from './infrastructure/IoCContainer';
import { LocalFileProtocolManager } from './infrastructure/LocalFileProtocolManager';
import { ProtocolManager } from './infrastructure/ProtocolManager';
import { RendererUrlManager } from './infrastructure/RendererUrlManager';
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
  localFileProtocolManager: LocalFileProtocolManager;
  binaryManager: BinaryManager;
  screenCaptureManager: ScreenCaptureManager;
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
    logger.info(` res: ${binDir}`);
    logger.info('----------------------------------------------');
    logger.info('Starting LobeHub...');

    // Append the CLI wrapper directory to PATH so spawned shells can resolve
    // `lobehub` / `lh` / `lobe`. Managed binary dirs (e.g. agent-browser) are
    // augmented separately by `binaryManager.augmentPath()` during bootstrap.
    const pathSep = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${process.env.PATH}${pathSep}${getCliWrapperDir()}`;

    logger.debug('Initializing App');
    // Initialize store manager
    this.storeManager = new StoreManager(this);

    this.rendererUrlManager = new RendererUrlManager();
    // Wire the backend reverse-proxy as an `app://` interceptor: keeps
    // RendererUrlManager ignorant of "what counts as a backend path" while
    // letting BackendProxyProtocolManager own that knowledge.
    this.rendererUrlManager.addRequestInterceptor(
      backendProxyProtocolManager.createAppRequestInterceptor(),
    );
    this.localFileProtocolManager = new LocalFileProtocolManager();
    void this.localFileProtocolManager.approveWorkspaceRoots(
      this.storeManager.get('localFileWorkspaceRoots', []),
    );
    protocol.registerSchemesAsPrivileged([
      this.rendererUrlManager.protocolScheme,
      this.localFileProtocolManager.protocolScheme,
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
    this.binaryManager = new BinaryManager(this);
    this.screenCaptureManager = new ScreenCaptureManager(this);

    // Register built-in binary specs
    this.registerBuiltinBinarySpecs();

    // Configure renderer loading strategy (dev server vs static export)
    // should register before app ready
    this.rendererUrlManager.configureRendererLoader();

    // Serves arbitrary local files (e.g. project file previews) via
    // `localfile://` to the renderer. Active in both dev and prod.
    this.localFileProtocolManager.registerHandler();

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
   * Register built-in binary specs the BinaryManager knows about.
   */
  private registerBuiltinBinarySpecs() {
    logger.debug('Registering built-in binary specs');

    const binaryCategories: Partial<Record<BinaryCategory, BinarySpec[]>> = {
      'runtime-environment': runtimeEnvironmentBinaries,
      'cli-agents': cliAgentBinaries,
      'ast-search': astSearchBinaries,
      'browser-automation': browserAutomationBinaries,
      'content-search': contentSearchBinaries,
      'file-search': fileSearchBinaries,
    };

    for (const [category, specs] of Object.entries(binaryCategories)) {
      if (specs) {
        for (const spec of specs) {
          this.binaryManager.register(spec, category as BinaryCategory);
        }
      }
    }

    logger.info(`Registered ${this.binaryManager.getRegistered().length} binary specs`);
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

    // Generate CLI wrapper for terminal usage
    generateCliWrapper().catch((error) => {
      logger.warn('Failed to generate CLI wrapper:', error);
    });

    // Surface previously-installed managed binaries on PATH so spawned shells
    // (and child agents) can resolve them without going through the manager.
    this.binaryManager.augmentPath().catch((error) => {
      logger.warn('Failed to augment PATH with managed binaries:', error);
    });

    // Lazy-install agent-browser in the background — keeps the installer
    // light (no bundled binary) while still making the CLI available shortly
    // after first launch. Errors are non-fatal; the Settings panel exposes a
    // manual retry via `binaryService.detect / ensure` later.
    this.binaryManager.ensure('agent-browser').catch((error) => {
      logger.warn('[agent-browser] background ensure failed:', error);
    });

    // Initialize i18n. Note: app.getLocale() must be called after app.whenReady() to get the correct value
    await this.i18n.init();
    this.menuManager.initialize();

    // Initialize static file manager
    await this.staticFileServerManager.initialize();

    // Initialize global shortcuts: globalShortcut must be called after app.whenReady()
    this.shortcutManager.initialize();

    await this.browserManager.initializeBrowsers();

    // Initialize tray manager on all platforms (macOS menu bar, Windows / Linux tray).
    this.trayManager.initializeTrays();

    // Initialize updater manager
    await this.updaterManager.initialize();

    // Set global application exit state
    this.isQuiting = false;

    app.on('window-all-closed', () => {
      if (electronIs.windows() || process.platform === 'linux') {
        logger.info(`All windows closed, quitting application (${process.platform})`);
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
    if (electronIs.macOS()) {
      app.dock!.setIcon(path.join(buildDir, 'icon-dev.png'));
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

    // Socket path is derived from this id (`${id}-electron-ipc.sock`). Keep the
    // package name by default; override with LOBE_IPC_ID so concurrent dev
    // instances get distinct sockets instead of the last one hijacking the path.
    const ipcId = process.env.LOBE_IPC_ID || name;
    this.ipcServer = new ElectronIPCServer(ipcId, ipcServerEvents);
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
