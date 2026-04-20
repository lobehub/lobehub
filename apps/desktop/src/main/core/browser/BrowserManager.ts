import type {
  MainBroadcastEventKey,
  MainBroadcastParams,
  TopicPopupInfo,
} from '@lobechat/electron-client-ipc';
import type { WebContents } from 'electron';

import { isLinux } from '@/const/env';
import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { createLogger } from '@/utils/logger';

import type { AppBrowsersIdentifiers, WindowTemplateIdentifiers } from '../../appBrowsers';
import { appBrowsers, BrowsersIdentifiers, windowTemplates } from '../../appBrowsers';
import type { App } from '../App';
import type { BrowserWindowOpts } from './Browser';
import Browser from './Browser';

const TOPIC_POPUP_TEMPLATE_ID: WindowTemplateIdentifiers = 'topicPopup';
const TOPIC_POPUP_PATH_RE = /^\/popup\/(agent|group)\/([^/?#]+)\/([^/?#]+)/;

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
    return this.retrieveByIdentifier(BrowsersIdentifiers.app);
  }

  showMainWindow() {
    logger.debug('Showing main window');
    const window = this.getMainWindow();
    window.show();
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
      path,
    };

    logger.debug(`Creating multi-instance window: ${windowId} with path: ${path}`);

    const browser = this.retrieveOrInitialize(browserOpts);

    if (templateId === TOPIC_POPUP_TEMPLATE_ID) {
      // Notify main-window SPAs so they can redirect to the popup instead of
      // rendering the same conversation in two places. Re-emit on close to
      // release the "topic is in popup" guard.
      this.emitTopicPopupsChanged();
      browser.browserWindow.once('closed', () => {
        this.emitTopicPopupsChanged();
      });
    }

    return {
      browser,
      identifier: windowId,
    };
  }

  /**
   * List currently-open topic popup windows (alive only). Used by the main
   * SPA to decide whether to render the conversation or a redirect-to-popup
   * guard.
   */
  listTopicPopups(): TopicPopupInfo[] {
    const popups: TopicPopupInfo[] = [];
    this.browsers.forEach((browser, identifier) => {
      if (!identifier.startsWith(`${TOPIC_POPUP_TEMPLATE_ID}_`)) return;
      const webContents = browser.webContents;
      if (!webContents || webContents.isDestroyed()) return;
      const match = browser.options.path.match(TOPIC_POPUP_PATH_RE);
      if (!match) return;
      const scope = match[1] as 'agent' | 'group';
      const id = match[2];
      const topicId = match[3];
      popups.push({
        identifier,
        scope,
        topicId,
        ...(scope === 'agent' ? { agentId: id } : { groupId: id }),
      });
    });
    return popups;
  }

  focusTopicPopup(identifier: string): boolean {
    const browser = this.browsers.get(identifier);
    if (!browser) return false;
    const win = browser.browserWindow;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  }

  private emitTopicPopupsChanged(): void {
    this.broadcastToAllWindows('topicPopupsChanged', { popups: this.listTopicPopups() });
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
  async initializeBrowsers() {
    logger.info('Initializing all browsers');

    // Check if onboarding is completed (remote server configured)
    const remoteServerConfigCtr = this.app.getController(RemoteServerConfigCtr);
    const isOnboardingCompleted = await remoteServerConfigCtr.isRemoteServerConfigured();

    Object.values(appBrowsers).forEach((browser: BrowserWindowOpts) => {
      logger.debug(`Initializing browser: ${browser.identifier}`);

      // Dynamically determine initial path for main window
      if (browser.identifier === BrowsersIdentifiers.app) {
        const initialPath = isOnboardingCompleted ? '/' : '/desktop-onboarding';
        browser = {
          ...browser,
          keepAlive: isLinux ? false : browser.keepAlive,
          path: initialPath,
        };
        logger.debug(`Main window initial path: ${initialPath}`);
      }

      if (browser.keepAlive || browser.identifier === BrowsersIdentifiers.app) {
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

    // Record the mapping between WebContents and identifier
    this.webContentsMap.set(browser.browserWindow.webContents, identifier);

    // Clean up the mapping when the window is closed
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

  isWindowMaximized(identifier: string) {
    const browser = this.browsers.get(identifier);
    return browser?.browserWindow.isMaximized() ?? false;
  }

  setWindowSize(identifier: string, size: { height?: number; width?: number }) {
    const browser = this.browsers.get(identifier);
    browser?.setWindowSize(size);
  }

  getWindowSize(identifier: string) {
    const browser = this.browsers.get(identifier);
    return browser?.browserWindow.getBounds();
  }

  setWindowMinimumSize(identifier: string, size: { height?: number; width?: number }) {
    const browser = this.browsers.get(identifier);
    browser?.setWindowMinimumSize(size);
  }

  setWindowAlwaysOnTop(identifier: string, flag: boolean) {
    const browser = this.browsers.get(identifier);
    browser?.browserWindow.setAlwaysOnTop(flag);
  }

  isWindowAlwaysOnTop(identifier: string) {
    const browser = this.browsers.get(identifier);
    return browser?.browserWindow.isAlwaysOnTop() ?? false;
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
