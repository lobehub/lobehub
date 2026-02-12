import console from 'node:console';
import { join } from 'node:path';

import { APP_WINDOW_MIN_SIZE } from '@lobechat/desktop-bridge';
import type { MainBroadcastEventKey, MainBroadcastParams } from '@lobechat/electron-client-ipc';
import type { BrowserWindowConstructorOptions } from 'electron';
import { BrowserWindow, ipcMain, screen, session as electronSession, shell } from 'electron';

import { preloadDir, resourcesDir } from '@/const/dir';
import { isMac } from '@/const/env';
import { ELECTRON_BE_PROTOCOL_SCHEME } from '@/const/protocol';
import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { backendProxyProtocolManager } from '@/core/infrastructure/BackendProxyProtocolManager';
import { appendVercelCookie, setResponseHeader } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';
import { WindowStateManager } from './WindowStateManager';
import { WindowThemeManager } from './WindowThemeManager';

const logger = createLogger('core:Browser');

// ==================== Types ====================

export interface BrowserWindowOpts extends BrowserWindowConstructorOptions {
  devTools?: boolean;
  height?: number;
  identifier: string;
  keepAlive?: boolean;
  parentIdentifier?: string;
  path: string;
  showOnInit?: boolean;
  title?: string;
  width?: number;
}

// ==================== Browser Class ====================

export default class Browser {
  private readonly app: App;
  private readonly stateManager: WindowStateManager;
  private readonly themeManager: WindowThemeManager;

  private _browserWindow?: BrowserWindow;

  readonly identifier: string;
  readonly options: BrowserWindowOpts;

  // ==================== Accessors ====================

  get browserWindow(): BrowserWindow {
    return this.retrieveOrInitialize();
  }

  get webContents() {
    if (this._browserWindow?.isDestroyed()) return null;
    return this._browserWindow?.webContents ?? null;
  }

  // ==================== Constructor ====================

  constructor(options: BrowserWindowOpts, application: App) {
    logger.debug(`Creating Browser instance: ${options.identifier}`);
    logger.debug(`Browser options: ${JSON.stringify(options)}`);

    this.app = application;
    this.identifier = options.identifier;
    this.options = options;

    // Initialize managers
    this.stateManager = new WindowStateManager(application, {
      identifier: options.identifier,
      keepAlive: options.keepAlive,
    });
    this.themeManager = new WindowThemeManager(options.identifier);

    // Initialize window
    this.retrieveOrInitialize();
  }

  // ==================== Window Lifecycle ====================

  /**
   * Initialize or retrieve existing browser window
   */
  retrieveOrInitialize(): BrowserWindow {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) {
      logger.debug(`[${this.identifier}] Returning existing BrowserWindow instance.`);
      return this._browserWindow;
    }

    const browserWindow = this.createBrowserWindow();
    this._browserWindow = browserWindow;

    this.setupWindow(browserWindow);

    logger.debug(`[${this.identifier}] retrieveOrInitialize completed.`);
    return browserWindow;
  }

  /**
   * Destroy window instance and cleanup resources
   */
  destroy(): void {
    logger.debug(`Destroying window instance: ${this.identifier}`);
    this.themeManager.cleanup();
    this._browserWindow = undefined;
  }

  // ==================== Window Creation ====================

  private createBrowserWindow(): BrowserWindow {
    const { title, width, height, ...rest } = this.options;

    const resolvedState = this.stateManager.resolveState({ height, width });
    logger.info(`Creating new BrowserWindow instance: ${this.identifier}`);
    logger.debug(`[${this.identifier}] Resolved window state: ${JSON.stringify(resolvedState)}`);

    return new BrowserWindow({
      ...rest,
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      darkTheme: this.themeManager.isDarkMode,
      frame: false,
      height: resolvedState.height,
      show: false,
      title,

      vibrancy: 'sidebar',
      visualEffectState: 'active',
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        preload: join(preloadDir, 'index.js'),
        sandbox: false,
        webviewTag: true,
      },
      width: resolvedState.width,
      x: resolvedState.x,
      y: resolvedState.y,
      ...this.themeManager.getPlatformConfig(),
    });
  }

  private setupWindow(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] BrowserWindow instance created.`);

    // Setup theme management
    this.themeManager.attach(browserWindow);

    // Setup network interceptors
    this.setupCORSBypass(browserWindow);
    this.setupRemoteServerRequestHook(browserWindow);

    // Load content
    this.initiateContentLoading();

    // Setup devtools if enabled
    if (this.options.devTools) {
      logger.debug(`[${this.identifier}] Opening DevTools.`);
      browserWindow.webContents.openDevTools();
    }

    // Setup event listeners
    this.setupEventListeners(browserWindow);

    // Setup external link handler (prevents opening new windows in renderer)
    this.setupWindowOpenHandler(browserWindow);
  }

  private initiateContentLoading(): void {
    logger.debug(`[${this.identifier}] Initiating placeholder and URL loading sequence.`);
    this.loadPlaceholder().then(() => {
      this.loadUrl(this.options.path).catch((e) => {
        logger.error(
          `[${this.identifier}] Initial loadUrl error for path '${this.options.path}':`,
          e,
        );
      });
    });
  }

  // ==================== Event Listeners ====================

  private setupEventListeners(browserWindow: BrowserWindow): void {
    this.setupReadyToShowListener(browserWindow);
    this.setupCloseListener(browserWindow);
    this.setupFocusListener(browserWindow);
    this.setupWillPreventUnloadListener(browserWindow);
    this.setupContextMenu(browserWindow);
  }

  /**
   * Setup window open handler to intercept external links
   * Prevents opening new windows in renderer and uses system browser instead
   */
  private setupWindowOpenHandler(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up window open handler for external links`);

    browserWindow.webContents.setWindowOpenHandler(({ url }) => {
      logger.info(`[${this.identifier}] Intercepted window open for URL: ${url}`);

      // Open external URL in system browser
      shell.openExternal(url).catch((error) => {
        logger.error(`[${this.identifier}] Failed to open external URL: ${url}`, error);
      });

      // Deny creating new window in renderer
      return { action: 'deny' };
    });
  }

  private setupWillPreventUnloadListener(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up 'will-prevent-unload' event listener.`);
    browserWindow.webContents.on('will-prevent-unload', (event) => {
      logger.debug(
        `[${this.identifier}] 'will-prevent-unload' fired. isQuiting: ${this.app.isQuiting}`,
      );
      if (this.app.isQuiting) {
        logger.info(`[${this.identifier}] App is quitting, ignoring beforeunload cancellation.`);
        event.preventDefault();
      }
    });
  }

  private setupReadyToShowListener(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up 'ready-to-show' event listener.`);
    browserWindow.once('ready-to-show', () => {
      logger.debug(`[${this.identifier}] Window 'ready-to-show' event fired.`);
      if (this.options.showOnInit) {
        logger.debug(`Showing window ${this.identifier} because showOnInit is true.`);
        browserWindow.show();
      } else {
        logger.debug(`Window ${this.identifier} not shown because showOnInit is false.`);
      }
    });
  }

  private setupCloseListener(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up 'close' event listener.`);
    const closeHandler = this.stateManager.createCloseHandler(browserWindow, {
      onCleanup: () => this.themeManager.cleanup(),
      onHide: () => this.hide(),
    });
    browserWindow.on('close', closeHandler);
  }

  private setupFocusListener(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up 'focus' event listener.`);
    browserWindow.on('focus', () => {
      logger.debug(`[${this.identifier}] Window 'focus' event fired.`);
      this.broadcast('windowFocused');
    });
  }

  /**
   * Setup context menu with platform-specific features
   * Delegates to MenuManager for consistent platform behavior
   */
  private setupContextMenu(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up context menu.`);

    browserWindow.webContents.on('context-menu', (_event, params) => {
      const { x, y, selectionText, linkURL, srcURL, mediaType, isEditable } = params;

      // Use the platform menu system with full context data
      this.app.menuManager.showContextMenu('default', {
        isEditable,
        linkURL: linkURL || undefined,
        mediaType: mediaType as any,
        selectionText: selectionText || undefined,
        srcURL: srcURL || undefined,
        x,
        y,
      });
    });
  }

  // ==================== Window Actions ====================

  show(): void {
    logger.debug(`Showing window: ${this.identifier}`);
    if (!this._browserWindow?.isDestroyed()) {
      this.determineWindowPosition();
    }
    this.browserWindow.show();
  }

  hide(): void {
    logger.debug(`Hiding window: ${this.identifier}`);

    // Fix for macOS fullscreen black screen issue
    // See: https://github.com/electron/electron/issues/20263
    if (isMac && this.browserWindow.isFullScreen()) {
      logger.debug(`[${this.identifier}] Exiting fullscreen before hiding.`);
      this.browserWindow.once('leave-full-screen', () => {
        this.browserWindow.hide();
      });
      this.browserWindow.setFullScreen(false);
    } else {
      this.browserWindow.hide();
    }
  }

  close(): void {
    logger.debug(`Attempting to close window: ${this.identifier}`);
    this.browserWindow.close();
  }

  toggleVisible(): void {
    logger.debug(`Toggling visibility for window: ${this.identifier}`);
    if (this._browserWindow?.isVisible() && this._browserWindow.isFocused()) {
      this.hide();
    } else {
      this._browserWindow?.show();
      this._browserWindow?.focus();
    }
  }

  moveToCenter(): void {
    logger.debug(`Centering window: ${this.identifier}`);
    this._browserWindow?.center();
  }

  setWindowSize(boundSize: { height?: number; width?: number }): void {
    logger.debug(`Setting window size for ${this.identifier}: ${JSON.stringify(boundSize)}`);
    const currentBounds = this._browserWindow?.getBounds();
    this._browserWindow?.setBounds({
      height: boundSize.height || currentBounds?.height,
      width: boundSize.width || currentBounds?.width,
    });
  }

  setWindowMinimumSize(size: { height?: number; width?: number }): void {
    logger.debug(`[${this.identifier}] Setting window minimum size: ${JSON.stringify(size)}`);

    const currentMinimumSize = this._browserWindow?.getMinimumSize?.() ?? [0, 0];
    const rawWidth = size.width ?? currentMinimumSize[0];
    const rawHeight = size.height ?? currentMinimumSize[1];

    // Electron doesn't "reset" minimum size with 0x0 reliably.
    // Treat 0 / negative as fallback to app-level default preset.
    const width = rawWidth > 0 ? rawWidth : APP_WINDOW_MIN_SIZE.width;
    const height = rawHeight > 0 ? rawHeight : APP_WINDOW_MIN_SIZE.height;

    this._browserWindow?.setMinimumSize?.(width, height);
  }

  // ==================== Window Position ====================

  private determineWindowPosition(): void {
    const { parentIdentifier } = this.options;
    if (!parentIdentifier) return;

    // todo: fix ts type
    const parentWin = this.app.browserManager.retrieveByIdentifier(parentIdentifier as any);
    if (!parentWin) return;

    logger.debug(`[${this.identifier}] Found parent window: ${parentIdentifier}`);

    const display = screen.getDisplayNearestPoint(parentWin.browserWindow.getContentBounds());
    if (!display) return;

    const { workArea } = display;
    const { width, height } = this._browserWindow!.getContentBounds();

    const newX = Math.floor(Math.max(workArea.x + (workArea.width - width) / 2, workArea.x));
    const newY = Math.floor(Math.max(workArea.y + (workArea.height - height) / 2, workArea.y));

    logger.debug(`[${this.identifier}] Calculated position: x=${newX}, y=${newY}`);
    this._browserWindow!.setPosition(newX, newY, false);
  }

  // ==================== Content Loading ====================

  loadPlaceholder = async (): Promise<void> => {
    logger.debug(`[${this.identifier}] Loading splash screen placeholder`);
    await this._browserWindow!.loadFile(join(resourcesDir, 'splash.html'));
    logger.debug(`[${this.identifier}] Splash screen placeholder loaded.`);
  };

  loadUrl = async (path: string): Promise<void> => {
    const initUrl = await this.app.buildRendererUrl(path);
    const urlWithLocale = this.buildUrlWithLocale(initUrl);

    console.log('[Browser] initUrl', urlWithLocale);

    try {
      logger.debug(`[${this.identifier}] Attempting to load URL: ${urlWithLocale}`);
      await this._browserWindow!.loadURL(urlWithLocale);
      logger.debug(`[${this.identifier}] Successfully loaded URL: ${urlWithLocale}`);
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to load URL (${urlWithLocale}):`, error);
      await this.handleLoadError(urlWithLocale);
    }
  };

  private buildUrlWithLocale(initUrl: string): string {
    const storedLocale = this.app.storeManager.get('locale', 'auto');
    if (storedLocale && storedLocale !== 'auto') {
      return `${initUrl}${initUrl.includes('?') ? '&' : '?'}lng=${storedLocale}`;
    }
    return initUrl;
  }

  private async handleLoadError(urlWithLocale: string): Promise<void> {
    try {
      logger.info(`[${this.identifier}] Attempting to load error page...`);
      await this._browserWindow!.loadFile(join(resourcesDir, 'error.html'));
      logger.info(`[${this.identifier}] Error page loaded successfully.`);

      this.setupRetryHandler(urlWithLocale);
    } catch (err) {
      logger.error(`[${this.identifier}] Failed to load error page:`, err);
      await this.loadFallbackError();
    }
  }

  private setupRetryHandler(urlWithLocale: string): void {
    ipcMain.removeHandler('retry-connection');
    logger.debug(`[${this.identifier}] Removed existing retry-connection handler if any.`);

    ipcMain.handle('retry-connection', async () => {
      logger.info(`[${this.identifier}] Retry connection requested for: ${urlWithLocale}`);
      try {
        await this._browserWindow?.loadURL(urlWithLocale);
        logger.info(`[${this.identifier}] Reconnection successful to ${urlWithLocale}`);
        return { success: true };
      } catch (err: any) {
        logger.error(`[${this.identifier}] Retry connection failed:`, err);
        try {
          await this._browserWindow?.loadFile(join(resourcesDir, 'error.html'));
        } catch (loadErr) {
          logger.error(`[${this.identifier}] Failed to reload error page:`, loadErr);
        }
        return { error: err.message, success: false };
      }
    });
    logger.debug(`[${this.identifier}] Set up retry-connection handler.`);
  }

  private async loadFallbackError(): Promise<void> {
    try {
      logger.warn(`[${this.identifier}] Attempting to load fallback error HTML string...`);
      await this._browserWindow!.loadURL(
        'data:text/html,<html><body><h1>Loading Failed</h1><p>Unable to connect to server, please restart the application</p></body></html>',
      );
      logger.info(`[${this.identifier}] Fallback error HTML string loaded.`);
    } catch (finalErr) {
      logger.error(`[${this.identifier}] Unable to display any page:`, finalErr);
    }
  }

  // ==================== Communication ====================

  broadcast = <T extends MainBroadcastEventKey>(
    channel: T,
    data?: MainBroadcastParams<T>,
  ): void => {
    if (this._browserWindow?.isDestroyed()) return;
    logger.debug(`Broadcasting to window ${this.identifier}, channel: ${channel}`);
    this._browserWindow!.webContents.send(channel, data);
  };

  // ==================== Theme (Delegated) ====================

  /**
   * Handle application theme mode change (called from BrowserManager)
   */
  handleAppThemeChange = (): void => {
    this.themeManager.handleAppThemeChange();
  };

  /**
   * Manually reapply visual effects
   */
  reapplyVisualEffects(): void {
    this.themeManager.reapplyVisualEffects();
  }

  // ==================== Network Setup ====================

  /**
   * Setup CORS bypass for ALL requests
   * In production, the renderer uses app://next protocol which triggers CORS
   */
  private setupCORSBypass(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up CORS bypass for all requests`);

    const session = browserWindow.webContents.session;
    const originMap = new Map<number, string>();

    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = { ...details.requestHeaders };

      if (requestHeaders['Origin']) {
        originMap.set(details.id, requestHeaders['Origin']);
        delete requestHeaders['Origin'];
        logger.debug(`[${this.identifier}] Removed Origin header for: ${details.url}`);
      }

      appendVercelCookie(requestHeaders);

      callback({ requestHeaders });
    });

    session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = details.responseHeaders || {};
      const origin = originMap.get(details.id) || '*';

      // Force set CORS headers (replace existing to avoid duplicates from case-insensitive keys)
      setResponseHeader(responseHeaders, 'Access-Control-Allow-Origin', origin);
      setResponseHeader(
        responseHeaders,
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      );
      setResponseHeader(responseHeaders, 'Access-Control-Allow-Headers', '*');
      setResponseHeader(responseHeaders, 'Access-Control-Allow-Credentials', 'true');

      originMap.delete(details.id);

      if (details.method === 'OPTIONS') {
        setResponseHeader(responseHeaders, 'Access-Control-Max-Age', '86400');
        callback({ responseHeaders, statusLine: 'HTTP/1.1 200 OK' });
        return;
      }

      callback({ responseHeaders });
    });

    logger.debug(`[${this.identifier}] CORS bypass setup completed`);
  }

  /**
   * Rewrite tRPC requests to remote server and inject OIDC token
   */
  private setupRemoteServerRequestHook(browserWindow: BrowserWindow): void {
    const session = browserWindow.webContents.session;
    const remoteServerConfigCtr = this.app.getController(RemoteServerConfigCtr);

    const targetSession = session || electronSession.defaultSession;
    if (!targetSession) return;

    backendProxyProtocolManager.registerWithRemoteBaseUrl(targetSession, {
      getAccessToken: () => remoteServerConfigCtr.getAccessToken(),
      getRemoteBaseUrl: async () => {
        const config = await remoteServerConfigCtr.getRemoteServerConfig();
        const remoteServerUrl = await remoteServerConfigCtr.getRemoteServerUrl(config);
        return remoteServerUrl || null;
      },
      scheme: ELECTRON_BE_PROTOCOL_SCHEME,
      source: this.identifier,
    });
  }
}
