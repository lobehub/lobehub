import {
  MainBroadcastEventKey,
  MainBroadcastParams,
  OpenSettingsWindowOptions,
} from '@lobechat/electron-client-ipc';
import { WebContents } from 'electron';

import { createLogger } from '@/utils/logger';

import {
  AppBrowsersIdentifiers,
  WindowTemplateIdentifiers,
  appBrowsers,
  windowTemplates,
} from '../../appBrowsers';
import type { App } from '../App';
import type { BrowserWindowOpts } from './Browser';
import Browser from './Browser';

// Create logger
const logger = createLogger('core:BrowserManager');

export class BrowserManager {
  app: App;

  browsers: Map<string, Browser> = new Map();

  private webContentsMap = new Map<WebContents, string>();

  constructor(app: App) {
    logger.debug('Initializing BrowserManager');
    this.app = app;
  }

  getMainWindow() {
    return this.retrieveByIdentifier('chat');
  }

  showMainWindow() {
    logger.debug('Showing main window');
    const window = this.getMainWindow();
    window.show();
  }

  showSettingsWindow() {
    logger.debug('Showing settings window');
    const window = this.retrieveByIdentifier('settings');
    window.show();
    return window;
  }

  broadcastToAllWindows = <T extends MainBroadcastEventKey>(
    event: T,
    data: MainBroadcastParams<T>,
  ) => {
    logger.debug(`Broadcasting event ${event} to all windows`);
    this.browsers.forEach((browser) => {
      browser.broadcast(event, data);
    });
  };

  broadcastToWindow = <T extends MainBroadcastEventKey>(
    identifier: string,
    event: T,
    data: MainBroadcastParams<T>,
  ) => {
    logger.debug(`Broadcasting event ${event} to window: ${identifier}`);
    this.browsers.get(identifier)?.broadcast(event, data);
  };

  /**
   * Display the settings window and navigate to a specific tab
   * @param tab Settings window sub-path tab
   */
  async showSettingsWindowWithTab(options?: OpenSettingsWindowOptions) {
    const tab = options?.tab;
    const searchParams = options?.searchParams;

    const query = new URLSearchParams();
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined) query.set(key, value);
      });
    }

    if (tab && tab !== 'common' && !query.has('active')) {
      query.set('active', tab);
    }

    const queryString = query.toString();
    const activeTab = query.get('active') ?? tab;

    logger.debug(
      `Showing settings window with navigation: active=${activeTab || 'default'}, query=${
        queryString || 'none'
      }`,
    );

    if (queryString) {
      const browser = await this.redirectToPage('settings', undefined, queryString);

      // make provider page more large
      if (activeTab?.startsWith('provider')) {
        logger.debug('Resizing window for provider settings');
        browser.setWindowSize({ height: 1000, width: 1400 });
        browser.moveToCenter();
      }

      return browser;
    } else {
      return this.showSettingsWindow();
    }
  }

  /**
   * Navigate window to specific sub-path
   * @param identifier Window identifier
   * @param subPath Sub-path, such as 'agent', 'about', etc.
   */
  async redirectToPage(identifier: string, subPath?: string, search?: string) {
    try {
      // Ensure window is retrieved or created
      const browser = this.retrieveByIdentifier(identifier);
      browser.hide();

      // Handle both static and dynamic windows
      let baseRoute: string;
      if (identifier in appBrowsers) {
        baseRoute = appBrowsers[identifier as AppBrowsersIdentifiers].path;
      } else {
        // For dynamic windows, extract base route from the browser options
        const browserOptions = browser.options;
        baseRoute = browserOptions.path;
      }

      // Build complete URL path
      const fullPath = subPath ? `${baseRoute}/${subPath}` : baseRoute;
      const normalizedSearch =
        search && search.length > 0 ? (search.startsWith('?') ? search : `?${search}`) : '';
      const fullUrl = `${fullPath}${normalizedSearch}`;

      logger.debug(`Redirecting to: ${fullUrl}`);

      // Load URL and show window
      await browser.loadUrl(fullUrl);
      browser.show();

      return browser;
    } catch (error) {
      logger.error(`Failed to redirect (${identifier}/${subPath}):`, error);
      throw error;
    }
  }

  /**
   * get Browser by identifier
   */
  retrieveByIdentifier(identifier: string) {
    const browser = this.browsers.get(identifier);

    if (browser) return browser;

    // Check if it's a static browser
    if (identifier in appBrowsers) {
      logger.debug(`Browser ${identifier} not found, initializing new instance`);
      return this.retrieveOrInitialize(appBrowsers[identifier as AppBrowsersIdentifiers]);
    }

    throw new Error(`Browser ${identifier} not found and is not a static browser`);
  }

  /**
   * Create a multi-instance window from template
   * @param templateId Template identifier
   * @param path Full path with query parameters
   * @param uniqueId Optional unique identifier, will be generated if not provided
   * @returns The window identifier and Browser instance
   */
  createMultiInstanceWindow(
    templateId: WindowTemplateIdentifiers,
    path: string,
    uniqueId?: string,
  ) {
    const template = windowTemplates[templateId];
    if (!template) {
      throw new Error(`Window template ${templateId} not found`);
    }

    // Generate unique identifier
    const windowId =
      uniqueId ||
      `${template.baseIdentifier}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // Create browser options from template
    const browserOpts: BrowserWindowOpts = {
      ...template,
      identifier: windowId,
      path: path,
    };

    logger.debug(`Creating multi-instance window: ${windowId} with path: ${path}`);

    const browser = this.retrieveOrInitialize(browserOpts);

    return {
      browser: browser,
      identifier: windowId,
    };
  }

  /**
   * Get all windows based on template
   * @param templateId Template identifier
   * @returns Array of window identifiers matching the template
   */
  getWindowsByTemplate(templateId: string): string[] {
    const prefix = `${templateId}_`;
    return Array.from(this.browsers.keys()).filter((id) => id.startsWith(prefix));
  }

  /**
   * Close all windows based on template
   * @param templateId Template identifier
   */
  closeWindowsByTemplate(templateId: string): void {
    const windowIds = this.getWindowsByTemplate(templateId);
    windowIds.forEach((id) => {
      const browser = this.browsers.get(id);
      if (browser) {
        browser.close();
      }
    });
  }

  /**
   * Initialize all browsers when app starts up
   */
  initializeBrowsers() {
    logger.info('Initializing all browsers');
    Object.values(appBrowsers).forEach((browser: BrowserWindowOpts) => {
      logger.debug(`Initializing browser: ${browser.identifier}`);

      if (browser.keepAlive) {
        this.retrieveOrInitialize(browser);
      }
    });
  }

  // helper

  /**
   * Retrieve existing browser or initialize a new one
   * @param options Browser window options
   */
  private retrieveOrInitialize(options: BrowserWindowOpts) {
    let browser = this.browsers.get(options.identifier);
    if (browser) {
      logger.debug(`Retrieved existing browser: ${options.identifier}`);
      return browser;
    }

    logger.debug(`Creating new browser: ${options.identifier}`);
    browser = new Browser(options, this.app);

    const identifier = options.identifier;
    this.browsers.set(identifier, browser);

    // 记录 WebContents 和 identifier 的映射
    this.webContentsMap.set(browser.browserWindow.webContents, identifier);

    // 当窗口关闭时清理映射
    browser.browserWindow.on('close', () => {
      if (browser.webContents) this.webContentsMap.delete(browser.webContents);
    });

    browser.browserWindow.on('show', () => {
      if (browser.webContents) this.webContentsMap.set(browser.webContents, browser.identifier);
    });

    return browser;
  }

  closeWindow(identifier: string) {
    const browser = this.browsers.get(identifier);
    browser?.close();
  }

  minimizeWindow(identifier: string) {
    const browser = this.browsers.get(identifier);
    browser?.browserWindow.minimize();
  }

  maximizeWindow(identifier: string) {
    const browser = this.browsers.get(identifier);
    if (browser?.browserWindow.isMaximized()) {
      browser?.browserWindow.unmaximize();
    } else {
      browser?.browserWindow.maximize();
    }
  }

  getIdentifierByWebContents(webContents: WebContents): string | null {
    return this.webContentsMap.get(webContents) || null;
  }

  /**
   * Handle application theme mode changes and reapply visual effects to all windows
   */
  handleAppThemeChange(): void {
    logger.debug('Handling app theme change for all browser windows');
    this.browsers.forEach((browser) => {
      browser.handleAppThemeChange();
    });
  }
}
