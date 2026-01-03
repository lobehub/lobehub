import {
  DEFAULT_VARIANTS,
  LOBE_LOCALE_COOKIE,
  LOBE_THEME_APPEARANCE,
  Locales,
  RouteVariants,
} from '@lobechat/desktop-bridge';
import { ElectronIPCEventHandler, ElectronIPCServer } from '@lobechat/electron-server-ipc';
import { app, nativeTheme, protocol, session } from 'electron';
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { macOS, windows } from 'electron-is';
import { pathExistsSync } from 'fs-extra';
import os from 'node:os';
import { extname, join } from 'node:path';

import { name } from '@/../../package.json';
import { buildDir, nextExportDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { ELECTRON_BE_PROTOCOL_SCHEME } from '@/const/protocol';
import { IControlModule } from '@/controllers';
import { getDesktopEnv } from '@/env';
import { IServiceModule } from '@/services';
import { getServerMethodMetadata } from '@/utils/ipc';
import { createLogger } from '@/utils/logger';

import { BrowserManager } from './browser/BrowserManager';
import { I18nManager } from './infrastructure/I18nManager';
import { IoCContainer } from './infrastructure/IoCContainer';
import { ProtocolManager } from './infrastructure/ProtocolManager';
import { RendererProtocolManager } from './infrastructure/RendererProtocolManager';
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

const devDefaultRendererUrl = 'http://localhost:3015';

export class App {
  rendererLoadedUrl: string;

  browserManager: BrowserManager;
  menuManager: MenuManager;
  i18n: I18nManager;
  storeManager: StoreManager;
  updaterManager: UpdaterManager;
  shortcutManager: ShortcutManager;
  trayManager: TrayManager;
  staticFileServerManager: StaticFileServerManager;
  protocolManager: ProtocolManager;
  rendererProtocolManager: RendererProtocolManager;
  chromeFlags: string[] = ['OverlayScrollbar', 'FluentOverlayScrollbar', 'FluentScrollbar'];
  /**
   * Escape hatch: allow testing static renderer in dev via env
   */
  private readonly rendererStaticOverride = getDesktopEnv().DESKTOP_RENDERER_STATIC;

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

    this.rendererProtocolManager = new RendererProtocolManager({
      nextExportDir,
      resolveRendererFilePath: this.resolveRendererFilePath.bind(this),
    });
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
      this.rendererProtocolManager.protocolScheme,
    ]);

    // Initialize rendererLoadedUrl from RendererProtocolManager
    this.rendererLoadedUrl = this.rendererProtocolManager.getRendererUrl();

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

    // Configure renderer loading strategy (dev server vs static export)
    // should register before app ready
    this.configureRendererLoader();

    // initialize protocol handlers
    this.protocolManager.initialize();

    // 统一处理 before-quit 事件
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
    const themeMode = this.storeManager.get('themeMode');

    if (themeMode) {
      nativeTheme.themeSource = themeMode === 'auto' ? 'system' : themeMode;
      logger.debug(
        `Theme mode initialized to: ${themeMode} (themeSource: ${nativeTheme.themeSource})`,
      );
    }
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

    const serverMethods = getServerMethodMetadata(ControllerClass);
    serverMethods?.forEach((methodName, propertyKey) => {
      const channel = `${ControllerClass.groupName}.${methodName}`;
      this.ipcServerEventMap.set(channel, {
        controller,
        methodName: propertyKey,
      });
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

  private resolveExportFilePath(pathname: string) {
    // Normalize by removing leading/trailing slashes so extname works as expected
    const normalizedPath = decodeURIComponent(pathname).replace(/^\/+/, '').replace(/\/$/, '');

    if (!normalizedPath) return join(nextExportDir, 'index.html');

    const basePath = join(nextExportDir, normalizedPath);
    const ext = extname(normalizedPath);

    // If the request explicitly includes an extension (e.g. html, ico, txt),
    // treat it as a direct asset without variant injection.
    if (ext) {
      return pathExistsSync(basePath) ? basePath : null;
    }

    const candidates = [`${basePath}.html`, join(basePath, 'index.html'), basePath];

    for (const candidate of candidates) {
      if (pathExistsSync(candidate)) return candidate;
    }

    const fallback404 = join(nextExportDir, '404.html');
    if (pathExistsSync(fallback404)) return fallback404;

    return null;
  }

  /**
   * Configure renderer loading strategy for dev/prod
   */
  private configureRendererLoader() {
    if (isDev && !this.rendererStaticOverride) {
      this.rendererLoadedUrl = devDefaultRendererUrl;
      this.setupDevRenderer();
      return;
    }

    if (isDev && this.rendererStaticOverride) {
      logger.warn('Dev mode: DESKTOP_RENDERER_STATIC enabled, using static renderer handler');
    }

    this.setupProdRenderer();
  }

  /**
   * Development: use Next dev server directly
   */
  private setupDevRenderer() {
    logger.info('Development mode: renderer served from Next dev server, no protocol hook');
  }

  /**
   * Production: serve static Next export assets
   */
  private setupProdRenderer() {
    // Use the URL from RendererProtocolManager
    this.rendererLoadedUrl = this.rendererProtocolManager.getRendererUrl();
    this.rendererProtocolManager.registerHandler();
  }

  /**
   * Resolve renderer file path in production by combining variant prefix and pathname.
   * Falls back to default variant when cookies are missing or invalid.
   */
  private async resolveRendererFilePath(url: URL) {
    const pathname = url.pathname;
    const normalizedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    // Static assets should be resolved from root (no variant prefix)
    if (
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/static/') ||
      pathname === '/favicon.ico' ||
      pathname === '/manifest.json'
    ) {
      return this.resolveExportFilePath(pathname);
    }

    // If the incoming path already contains an extension (like .html or .ico),
    // treat it as a direct asset lookup to avoid double variant prefixes.
    const extension = extname(normalizedPathname);
    if (extension) {
      const directPath = this.resolveExportFilePath(pathname);
      if (directPath) return directPath;

      // Next.js RSC payloads are emitted under variant folders (e.g. /en-US__0__light/__next._tree.txt),
      // but the runtime may request them without the variant prefix. For missing .txt requests,
      // retry resolution with variant injection.
      if (extension === '.txt' && normalizedPathname.includes('__next.')) {
        const variant = await this.getRouteVariantFromCookies();

        return (
          this.resolveExportFilePath(`/${variant}${pathname}`) ||
          this.resolveExportFilePath(`/${this.defaultRouteVariant}${pathname}`) ||
          null
        );
      }

      return null;
    }

    const variant = await this.getRouteVariantFromCookies();
    const variantPrefixedPath = `/${variant}${pathname}`;

    // Try variant-specific path first, then default variant as fallback
    return (
      this.resolveExportFilePath(variantPrefixedPath) ||
      this.resolveExportFilePath(`/${this.defaultRouteVariant}${pathname}`) ||
      null
    );
  }

  private readonly defaultRouteVariant = RouteVariants.serializeVariants(DEFAULT_VARIANTS);
  private readonly localeCookieName = LOBE_LOCALE_COOKIE;
  private readonly themeCookieName = LOBE_THEME_APPEARANCE;

  /**
   * Build variant string from Electron session cookies to match Next export structure.
   * Desktop is always treated as non-mobile (0).
   */
  private async getRouteVariantFromCookies(): Promise<string> {
    try {
      const cookies = await session.defaultSession.cookies.get({
        url: `${this.rendererLoadedUrl}/`,
      });
      const locale = cookies.find((c) => c.name === this.localeCookieName)?.value;
      const themeCookie = cookies.find((c) => c.name === this.themeCookieName)?.value;

      const serialized = RouteVariants.serializeVariants(
        RouteVariants.createVariants({
          isMobile: false,
          locale: locale as Locales | undefined,
          theme: themeCookie === 'dark' || themeCookie === 'light' ? themeCookie : undefined,
        }),
      );

      return RouteVariants.serializeVariants(RouteVariants.deserializeVariants(serialized));
    } catch (error) {
      logger.warn('Failed to read route variant cookies, using default', error);
      return this.defaultRouteVariant;
    }
  }

  /**
   * Build renderer URL with variant prefix injected into the path.
   * In dev mode (without static override), Next.js dev server handles routing automatically.
   * In prod or dev with static override, we need to inject variant to match export structure: /[variants]/path
   */
  async buildRendererUrl(path: string): Promise<string> {
    // Ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    // In dev mode without static override, use dev server directly (no variant needed)
    if (isDev && !this.rendererStaticOverride) {
      return `${this.rendererLoadedUrl}${cleanPath}`;
    }

    // In prod or dev with static override, inject variant for static export structure
    const variant = await this.getRouteVariantFromCookies();
    return `${this.rendererLoadedUrl}/${variant}.html${cleanPath}`;
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
  };
}
