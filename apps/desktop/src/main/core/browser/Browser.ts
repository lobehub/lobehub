import { MainBroadcastEventKey, MainBroadcastParams } from '@lobechat/electron-client-ipc';
import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  session as electronSession,
  ipcMain,
  nativeTheme,
  screen,
} from 'electron';
import console from 'node:console';
import { join } from 'node:path';

import { buildDir, preloadDir, resourcesDir } from '@/const/dir';
import { isDev, isMac, isWindows } from '@/const/env';
import { ELECTRON_BE_PROTOCOL_SCHEME } from '@/const/protocol';
import {
  BACKGROUND_DARK,
  BACKGROUND_LIGHT,
  SYMBOL_COLOR_DARK,
  SYMBOL_COLOR_LIGHT,
  THEME_CHANGE_DELAY,
  TITLE_BAR_HEIGHT,
} from '@/const/theme';
import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { backendProxyProtocolManager } from '@/core/infrastructure/BackendProxyProtocolManager';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';

// Create logger
const logger = createLogger('core:Browser');

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

interface WindowState {
  height?: number;
  width?: number;
  x?: number;
  y?: number;
}

export default class Browser {
  private app: App;
  private _browserWindow?: BrowserWindow;
  private themeListenerSetup = false;
  identifier: string;
  options: BrowserWindowOpts;
  private readonly windowStateKey: string;

  get browserWindow() {
    return this.retrieveOrInitialize();
  }
  get webContents() {
    if (this._browserWindow.isDestroyed()) return null;
    return this._browserWindow.webContents;
  }

  /**
   * Method to construct BrowserWindows object
   * @param options
   * @param application
   */
  constructor(options: BrowserWindowOpts, application: App) {
    logger.debug(`Creating Browser instance: ${options.identifier}`);
    logger.debug(`Browser options: ${JSON.stringify(options)}`);
    this.app = application;
    this.identifier = options.identifier;
    this.options = options;
    this.windowStateKey = `windowSize_${this.identifier}`;

    // Initialization
    this.retrieveOrInitialize();
  }

  /**
   * Get platform-specific theme configuration for window creation
   */
  private getPlatformThemeConfig(): Record<string, any> {
    if (isWindows) {
      return this.getWindowsThemeConfig(this.isDarkMode);
    }

    return {};
  }

  /**
   * Get Windows-specific theme configuration
   */
  private getWindowsThemeConfig(isDarkMode: boolean) {
    return {
      backgroundColor: isDarkMode ? BACKGROUND_DARK : BACKGROUND_LIGHT,
      icon: isDev ? join(buildDir, 'icon-dev.ico') : undefined,
      titleBarOverlay: {
        color: isDarkMode ? BACKGROUND_DARK : BACKGROUND_LIGHT,
        height: TITLE_BAR_HEIGHT,
        symbolColor: isDarkMode ? SYMBOL_COLOR_DARK : SYMBOL_COLOR_LIGHT,
      },
      titleBarStyle: 'hidden' as const,
    };
  }

  private setupThemeListener(): void {
    if (this.themeListenerSetup) return;

    nativeTheme.on('updated', this.handleThemeChange);
    this.themeListenerSetup = true;
  }

  private handleThemeChange = (): void => {
    logger.debug(`[${this.identifier}] System theme changed, reapplying visual effects.`);
    setTimeout(() => {
      this.applyVisualEffects();
    }, THEME_CHANGE_DELAY);
  };

  /**
   * Handle application theme mode change (called from BrowserManager)
   */
  handleAppThemeChange = (): void => {
    logger.debug(`[${this.identifier}] App theme mode changed, reapplying visual effects.`);
    setTimeout(() => {
      this.applyVisualEffects();
    }, THEME_CHANGE_DELAY);
  };

  private applyVisualEffects(): void {
    if (!this._browserWindow || this._browserWindow.isDestroyed()) return;

    logger.debug(`[${this.identifier}] Applying visual effects for platform`);
    const isDarkMode = this.isDarkMode;

    try {
      if (isWindows) {
        this.applyWindowsVisualEffects(isDarkMode);
      }

      logger.debug(
        `[${this.identifier}] Visual effects applied successfully (dark mode: ${isDarkMode})`,
      );
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to apply visual effects:`, error);
    }
  }

  private applyWindowsVisualEffects(isDarkMode: boolean): void {
    const config = this.getWindowsThemeConfig(isDarkMode);

    this._browserWindow.setBackgroundColor(config.backgroundColor);
    this._browserWindow.setTitleBarOverlay(config.titleBarOverlay);
  }

  private clampNumber(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }

  private resolveWindowState(
    savedState: WindowState | undefined,
    fallbackState: { height?: number; width?: number },
  ): WindowState {
    const width = savedState?.width ?? fallbackState.width;
    const height = savedState?.height ?? fallbackState.height;
    const resolvedState: WindowState = { height, width };

    const hasPosition = Number.isFinite(savedState?.x) && Number.isFinite(savedState?.y);
    if (!hasPosition) return resolvedState;

    const x = savedState?.x as number;
    const y = savedState?.y as number;

    const targetDisplay = screen.getDisplayMatching({
      height: height ?? 0,
      width: width ?? 0,
      x,
      y,
    });

    const workArea = targetDisplay?.workArea ?? screen.getPrimaryDisplay().workArea;
    const resolvedWidth = typeof width === 'number' ? Math.min(width, workArea.width) : width;
    const resolvedHeight = typeof height === 'number' ? Math.min(height, workArea.height) : height;

    const maxX = workArea.x + Math.max(0, workArea.width - (resolvedWidth ?? 0));
    const maxY = workArea.y + Math.max(0, workArea.height - (resolvedHeight ?? 0));

    return {
      height: resolvedHeight,
      width: resolvedWidth,
      x: this.clampNumber(x, workArea.x, maxX),
      y: this.clampNumber(y, workArea.y, maxY),
    };
  }

  private cleanupThemeListener(): void {
    if (this.themeListenerSetup) {
      // Note: nativeTheme listeners are global, consider using a centralized theme manager
      nativeTheme.off('updated', this.handleThemeChange);
      // for multiple windows to avoid duplicate listeners
      this.themeListenerSetup = false;
    }
  }

  private get isDarkMode() {
    return nativeTheme.shouldUseDarkColors;
  }

  loadUrl = async (path: string) => {
    const initUrl = await this.app.buildRendererUrl(path);

    // Inject locale from store to help renderer boot with the correct language.
    // Skip when set to auto to let the renderer detect locale normally.
    const storedLocale = this.app.storeManager.get('locale', 'auto');
    const urlWithLocale =
      storedLocale && storedLocale !== 'auto'
        ? `${initUrl}${initUrl.includes('?') ? '&' : '?'}lng=${storedLocale}`
        : initUrl;

    console.log('[Browser] initUrl', urlWithLocale);

    try {
      logger.debug(`[${this.identifier}] Attempting to load URL: ${urlWithLocale}`);
      await this._browserWindow.loadURL(urlWithLocale);

      logger.debug(`[${this.identifier}] Successfully loaded URL: ${urlWithLocale}`);
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to load URL (${urlWithLocale}):`, error);

      // Try to load local error page
      try {
        logger.info(`[${this.identifier}] Attempting to load error page...`);
        await this._browserWindow.loadFile(join(resourcesDir, 'error.html'));
        logger.info(`[${this.identifier}] Error page loaded successfully.`);

        // Remove previously set retry listeners to avoid duplicates
        ipcMain.removeHandler('retry-connection');
        logger.debug(`[${this.identifier}] Removed existing retry-connection handler if any.`);

        // Set retry logic
        ipcMain.handle('retry-connection', async () => {
          logger.info(`[${this.identifier}] Retry connection requested for: ${urlWithLocale}`);
          try {
            await this._browserWindow?.loadURL(urlWithLocale);
            logger.info(`[${this.identifier}] Reconnection successful to ${urlWithLocale}`);
            return { success: true };
          } catch (err) {
            logger.error(`[${this.identifier}] Retry connection failed for ${urlWithLocale}:`, err);
            // Reload error page
            try {
              logger.info(`[${this.identifier}] Reloading error page after failed retry...`);
              await this._browserWindow?.loadFile(join(resourcesDir, 'error.html'));
              logger.info(`[${this.identifier}] Error page reloaded.`);
            } catch (loadErr) {
              logger.error('[${this.identifier}] Failed to reload error page:', loadErr);
            }
            return { error: err.message, success: false };
          }
        });
        logger.debug(`[${this.identifier}] Set up retry-connection handler.`);
      } catch (err) {
        logger.error(`[${this.identifier}] Failed to load error page:`, err);
        // If even the error page can't be loaded, at least show a simple error message
        try {
          logger.warn(`[${this.identifier}] Attempting to load fallback error HTML string...`);
          await this._browserWindow.loadURL(
            'data:text/html,<html><body><h1>Loading Failed</h1><p>Unable to connect to server, please restart the application</p></body></html>',
          );
          logger.info(`[${this.identifier}] Fallback error HTML string loaded.`);
        } catch (finalErr) {
          logger.error(`[${this.identifier}] Unable to display any page:`, finalErr);
        }
      }
    }
  };

  loadPlaceholder = async () => {
    logger.debug(`[${this.identifier}] Loading splash screen placeholder`);
    // First load a local HTML loading page
    await this._browserWindow.loadFile(join(resourcesDir, 'splash.html'));
    logger.debug(`[${this.identifier}] Splash screen placeholder loaded.`);
  };

  show() {
    logger.debug(`Showing window: ${this.identifier}`);
    if (!this._browserWindow.isDestroyed()) this.determineWindowPosition();

    this.browserWindow.show();
  }

  private determineWindowPosition() {
    const { parentIdentifier } = this.options;

    if (parentIdentifier) {
      // todo: fix ts type
      const parentWin = this.app.browserManager.retrieveByIdentifier(parentIdentifier as any);
      if (parentWin) {
        logger.debug(`[${this.identifier}] Found parent window: ${parentIdentifier}`);

        const display = screen.getDisplayNearestPoint(parentWin.browserWindow.getContentBounds());
        if (display) {
          const {
            workArea: { x, y, width: displayWidth, height: displayHeight },
          } = display;

          const { width, height } = this._browserWindow.getContentBounds();
          logger.debug(
            `[${this.identifier}] Display bounds: x=${x}, y=${y}, width=${displayWidth}, height=${displayHeight}`,
          );

          // Calculate new position
          const newX = Math.floor(Math.max(x + (displayWidth - width) / 2, x));
          const newY = Math.floor(Math.max(y + (displayHeight - height) / 2, y));
          logger.debug(`[${this.identifier}] Calculated position: x=${newX}, y=${newY}`);
          this._browserWindow.setPosition(newX, newY, false);
        }
      }
    }
  }

  hide() {
    logger.debug(`Hiding window: ${this.identifier}`);

    // Fix for macOS fullscreen black screen issue
    // See: https://github.com/electron/electron/issues/20263
    if (isMac && this.browserWindow.isFullScreen()) {
      logger.debug(
        `[${this.identifier}] Window is in fullscreen mode, exiting fullscreen before hiding.`,
      );
      this.browserWindow.once('leave-full-screen', () => {
        this.browserWindow.hide();
      });
      this.browserWindow.setFullScreen(false);
    } else {
      this.browserWindow.hide();
    }
  }

  close() {
    logger.debug(`Attempting to close window: ${this.identifier}`);
    this.browserWindow.close();
  }

  /**
   * Destroy instance
   */
  destroy() {
    logger.debug(`Destroying window instance: ${this.identifier}`);
    this.cleanupThemeListener();
    this._browserWindow = undefined;
  }

  /**
   * Initialize
   */
  retrieveOrInitialize() {
    // When there is this window and it has not been destroyed
    if (this._browserWindow && !this._browserWindow.isDestroyed()) {
      logger.debug(`[${this.identifier}] Returning existing BrowserWindow instance.`);
      return this._browserWindow;
    }

    const { path, title, width, height, devTools, showOnInit, ...res } = this.options;

    // Load window state
    const savedState = this.app.storeManager.get(this.windowStateKey as any) as
      | WindowState
      | undefined;
    logger.info(`Creating new BrowserWindow instance: ${this.identifier}`);
    logger.debug(`[${this.identifier}] Options for new window: ${JSON.stringify(this.options)}`);
    logger.debug(
      `[${this.identifier}] Saved window state: ${JSON.stringify(savedState)}`,
    );

    const resolvedState = this.resolveWindowState(savedState, { height, width });
    logger.debug(
      `[${this.identifier}] Resolved window state: ${JSON.stringify(resolvedState)}`,
    );

    const browserWindow = new BrowserWindow({
      ...res,
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      darkTheme: this.isDarkMode,
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
      },
      width: resolvedState.width,
      x: resolvedState.x,
      y: resolvedState.y,
      ...this.getPlatformThemeConfig(),
    });

    this._browserWindow = browserWindow;
    logger.debug(`[${this.identifier}] BrowserWindow instance created.`);

    // Initialize theme listener for this window to handle theme changes
    this.setupThemeListener();
    logger.debug(`[${this.identifier}] Theme listener setup and applying initial visual effects.`);

    // Apply initial visual effects
    this.applyVisualEffects();

    // Setup CORS bypass for local file server
    this.setupCORSBypass(browserWindow);
    // Setup request hook for remote server sync (base URL rewrite + OIDC header)
    this.setupRemoteServerRequestHook(browserWindow);

    logger.debug(`[${this.identifier}] Initiating placeholder and URL loading sequence.`);
    this.loadPlaceholder().then(() => {
      this.loadUrl(path).catch((e) => {
        logger.error(`[${this.identifier}] Initial loadUrl error for path '${path}':`, e);
      });
    });

    // Show devtools if enabled
    if (devTools) {
      logger.debug(`[${this.identifier}] Opening DevTools because devTools option is true.`);
      browserWindow.webContents.openDevTools();
    }

    logger.debug(`[${this.identifier}] Setting up 'ready-to-show' event listener.`);
    browserWindow.once('ready-to-show', () => {
      logger.debug(`[${this.identifier}] Window 'ready-to-show' event fired.`);
      if (showOnInit) {
        logger.debug(`Showing window ${this.identifier} because showOnInit is true.`);
        browserWindow?.show();
      } else {
        logger.debug(
          `Window ${this.identifier} not shown on 'ready-to-show' because showOnInit is false.`,
        );
      }
    });

    logger.debug(`[${this.identifier}] Setting up 'close' event listener.`);
    browserWindow.on('close', (e) => {
      logger.debug(`Window 'close' event triggered for: ${this.identifier}`);
      logger.debug(
        `[${this.identifier}] State during close event: isQuiting=${this.app.isQuiting}, keepAlive=${this.options.keepAlive}`,
      );

      // If in application quitting process, allow window to be closed
      if (this.app.isQuiting) {
        logger.debug(`[${this.identifier}] App is quitting, allowing window to close naturally.`);
        // Save state before quitting
        try {
          const bounds = browserWindow.getBounds();
          const sizeState = {
            height: bounds.height,
            width: bounds.width,
            x: bounds.x,
            y: bounds.y,
          };
          logger.debug(
            `[${this.identifier}] Saving window state on quit: ${JSON.stringify(sizeState)}`,
          );
          this.app.storeManager.set(this.windowStateKey as any, sizeState);
        } catch (error) {
          logger.error(`[${this.identifier}] Failed to save window state on quit:`, error);
        }
        // Need to clean up theme manager
        this.cleanupThemeListener();
        return;
      }

      // Prevent window from being destroyed, just hide it (if marked as keepAlive)
      if (this.options.keepAlive) {
        logger.debug(
          `[${this.identifier}] keepAlive is true, preventing default close and hiding window.`,
        );
        // Optionally save state when hiding if desired, but primary save is on actual close/quit
        // try {
        //   const bounds = browserWindow.getBounds();
        //   logger.debug(`[${this.identifier}] Saving window state on hide: ${JSON.stringify(bounds)}`);
        //   this.app.storeManager.set(this.windowStateKey, bounds);
        // } catch (error) {
        //   logger.error(`[${this.identifier}] Failed to save window state on hide:`, error);
        // }
        e.preventDefault();
        this.hide();
      } else {
        // Window is actually closing (not keepAlive)
        logger.debug(
          `[${this.identifier}] keepAlive is false, allowing window to close. Saving state...`,
        );
        try {
          const bounds = browserWindow.getBounds();
          const sizeState = {
            height: bounds.height,
            width: bounds.width,
            x: bounds.x,
            y: bounds.y,
          };
          logger.debug(
            `[${this.identifier}] Saving window state on close: ${JSON.stringify(sizeState)}`,
          );
          this.app.storeManager.set(this.windowStateKey as any, sizeState);
        } catch (error) {
          logger.error(`[${this.identifier}] Failed to save window state on close:`, error);
        }
        // Need to clean up theme manager
        this.cleanupThemeListener();
      }
    });

    logger.debug(`[${this.identifier}] retrieveOrInitialize completed.`);
    return browserWindow;
  }

  moveToCenter() {
    logger.debug(`Centering window: ${this.identifier}`);
    this._browserWindow?.center();
  }

  setWindowSize(boundSize: { height?: number; width?: number }) {
    logger.debug(
      `Setting window size for ${this.identifier}: width=${boundSize.width}, height=${boundSize.height}`,
    );
    const windowSize = this._browserWindow.getBounds();
    this._browserWindow?.setBounds({
      height: boundSize.height || windowSize.height,
      width: boundSize.width || windowSize.width,
    });
  }

  setWindowResizable(resizable: boolean) {
    logger.debug(`[${this.identifier}] Setting window resizable: ${resizable}`);
    this._browserWindow?.setResizable(resizable);
  }

  broadcast = <T extends MainBroadcastEventKey>(channel: T, data?: MainBroadcastParams<T>) => {
    if (this._browserWindow.isDestroyed()) return;

    logger.debug(`Broadcasting to window ${this.identifier}, channel: ${channel}`);
    this._browserWindow.webContents.send(channel, data);
  };

  toggleVisible() {
    logger.debug(`Toggling visibility for window: ${this.identifier}`);
    if (this._browserWindow.isVisible() && this._browserWindow.isFocused()) {
      this.hide(); // Use the hide() method which handles fullscreen
    } else {
      this._browserWindow.show();
      this._browserWindow.focus();
    }
  }

  /**
   * Manually reapply visual effects (useful for fixing lost effects after window state changes)
   */
  reapplyVisualEffects(): void {
    logger.debug(`[${this.identifier}] Manually reapplying visual effects via Browser.`);
    this.applyVisualEffects();
  }

  /**
   * Setup CORS bypass for local file server (127.0.0.1:*)
   * This is needed for Electron to access files from the local static file server
   */
  private setupCORSBypass(browserWindow: BrowserWindow): void {
    logger.debug(`[${this.identifier}] Setting up CORS bypass for local file server`);

    const session = browserWindow.webContents.session;

    // Intercept response headers to add CORS headers
    session.webRequest.onHeadersReceived((details, callback) => {
      const url = details.url;

      // Only modify headers for local file server requests (127.0.0.1)
      if (url.includes('127.0.0.1') || url.includes('lobe-desktop-file')) {
        const responseHeaders = details.responseHeaders || {};

        // Add CORS headers
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];

        callback({
          responseHeaders,
        });
      } else {
        callback({ responseHeaders: details.responseHeaders });
      }
    });

    logger.debug(`[${this.identifier}] CORS bypass setup completed`);
  }

  /**
   * Rewrite tRPC requests to remote server and inject OIDC token via webRequest hooks.
   * Replaces the previous proxyTRPCRequest IPC forwarding.
   */
  private setupRemoteServerRequestHook(browserWindow: BrowserWindow) {
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
