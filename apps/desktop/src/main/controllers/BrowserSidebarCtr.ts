import type {
  BrowserSidebarAttachParams,
  BrowserSidebarImportResult,
  BrowserSidebarNavigateParams,
  BrowserSidebarResult,
  BrowserSidebarSessionParams,
  BrowserSidebarState,
} from '@lobechat/electron-client-ipc';
import type { WebContents, WebPreferences } from 'electron';
import {
  app as electronApp,
  clipboard,
  session as electronSession,
  shell,
  webContents as electronWebContents,
} from 'electron';

import { importChromeLoginData } from '@/modules/browser/importChromeLoginData';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:BrowserSidebarCtr');

// Shared persistent profile: logins/cookies survive across agents and restarts,
// mirroring a regular browser. Agent-driven sessions (M2) will get an isolated
// partition instead. The renderer sets this as the <webview> `partition`
// attribute — the only reliable identity channel into `will-attach-webview`
// (custom data-* attributes are NOT forwarded in its params).
const BROWSER_PARTITION = 'persist:lobe-browser-app';
const BROWSER_PARTITION_PREFIX = 'persist:lobe-browser-';
const DEFAULT_BROWSER_URL = 'about:blank';
const HTTP_URL_PATTERN = /^https?:\/\//i;
const LOCAL_URL_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#].*)?$/i;
const SUPPORTED_PROTOCOLS = new Set(['about:', 'http:', 'https:']);

interface BrowserPageRecord {
  error?: string;
  isLoading: boolean;
  sessionId: string;
  title: string;
  url: string;
  webContents?: WebContents;
}

const normalizeBrowserUrl = (value?: string): string => {
  const text = value?.trim();
  if (!text) return DEFAULT_BROWSER_URL;

  if (text === 'about:blank') return text;
  if (HTTP_URL_PATTERN.test(text)) return text;

  if (LOCAL_URL_PATTERN.test(text)) return `http://${text}`;

  if (text.includes(' ') || !text.includes('.')) {
    const searchUrl = new URL('https://www.bing.com/search');
    searchUrl.searchParams.set('q', text);
    return searchUrl.toString();
  }

  return `https://${text}`;
};

const isSupportedNavigationUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return SUPPORTED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
};

export default class BrowserSidebarCtr extends ControllerModule {
  static override readonly groupName = 'browserSidebar';

  private ownerWebContentsIds = new Set<number>();
  private pages = new Map<string, BrowserPageRecord>();
  private partitionConfigured = false;

  beforeAppReady() {
    electronApp.on('web-contents-created', (_event, webContents) => {
      this.attachOwnerWebContents(webContents);
    });
  }

  /**
   * Bind a session to an attached <webview> guest. Identity flows through this
   * explicit call (renderer reads `getWebContentsId()` on dom-ready) because
   * `will-attach-webview` params carry no custom attributes to match on.
   */
  @IpcMethod()
  attach(params: BrowserSidebarAttachParams): BrowserSidebarResult {
    const guest = electronWebContents.fromId(params.webContentsId);
    if (!guest || guest.isDestroyed()) {
      return { error: 'Webview is not available', success: false };
    }

    // Only guests living in our hardened browser partition may be claimed.
    if (guest.session !== electronSession.fromPartition(BROWSER_PARTITION)) {
      logger.warn(`Rejected attach for webContents ${params.webContentsId}: wrong session`);
      return { error: 'Webview does not belong to the browser sidebar', success: false };
    }

    if (this.getLiveWebContents(params.sessionId)?.id === guest.id) return { success: true };

    this.attachPageWebContents(params.sessionId, guest);
    return { success: true };
  }

  @IpcMethod()
  captureScreenshotToClipboard(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPageWebContents(params.sessionId, async (webContents) => {
      const image = await webContents.capturePage();
      clipboard.writeImage(image);
      return { success: true };
    });
  }

  @IpcMethod()
  getState(params: BrowserSidebarSessionParams): BrowserSidebarState {
    return this.snapshot(params.sessionId);
  }

  @IpcMethod()
  async importChromeLoginData(): Promise<BrowserSidebarImportResult> {
    try {
      const browserSession = electronSession.fromPartition(BROWSER_PARTITION);
      const importedCount = await importChromeLoginData(browserSession);
      return { importedCount, success: true };
    } catch (error) {
      logger.error('Failed to import Chrome login information:', error);
      return {
        error: error instanceof Error ? error.message : String(error),
        importedCount: 0,
        success: false,
      };
    }
  }

  @IpcMethod()
  goBack(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPageWebContents(params.sessionId, (webContents) => {
      if (!webContents.canGoBack()) return { success: false };
      webContents.goBack();
      return { success: true };
    });
  }

  @IpcMethod()
  goForward(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPageWebContents(params.sessionId, (webContents) => {
      if (!webContents.canGoForward()) return { success: false };
      webContents.goForward();
      return { success: true };
    });
  }

  @IpcMethod()
  async navigate(params: BrowserSidebarNavigateParams): Promise<BrowserSidebarResult> {
    const url = normalizeBrowserUrl(params.url);
    if (!isSupportedNavigationUrl(url)) {
      return { error: `Unsupported URL: ${url}`, success: false };
    }

    const page = this.ensurePage(params.sessionId);
    page.url = url;
    page.error = undefined;

    const webContents = this.getLiveWebContents(params.sessionId);
    if (!webContents) {
      this.broadcastState(params.sessionId);
      return { success: true };
    }

    await webContents.loadURL(url);
    this.updateSnapshot(params.sessionId);
    return { success: true };
  }

  @IpcMethod()
  openExternal(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPageWebContents(params.sessionId, async (webContents) => {
      const url = webContents.getURL();
      if (!url || !HTTP_URL_PATTERN.test(url)) {
        return { error: `Unsupported URL: ${url}`, success: false };
      }

      await shell.openExternal(url);
      return { success: true };
    });
  }

  @IpcMethod()
  reload(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPageWebContents(params.sessionId, (webContents) => {
      webContents.reload();
      return { success: true };
    });
  }

  @IpcMethod()
  stop(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPageWebContents(params.sessionId, (webContents) => {
      webContents.stop();
      return { success: true };
    });
  }

  private attachOwnerWebContents(webContents: WebContents): void {
    if (this.ownerWebContentsIds.has(webContents.id)) return;

    this.ownerWebContentsIds.add(webContents.id);

    webContents.on('will-attach-webview', (event, webPreferences, params) => {
      // Custom data-* attributes are not forwarded here, so the partition
      // attribute (set by the renderer) is the recognition signal.
      if (!params.partition?.startsWith(BROWSER_PARTITION_PREFIX)) return;

      const initialUrl = normalizeBrowserUrl(params.src);
      if (!isSupportedNavigationUrl(initialUrl)) {
        event.preventDefault();
        logger.warn(`Blocked unsupported browser sidebar URL: ${initialUrl}`);
        return;
      }

      this.configureBrowserSession();

      params.src = initialUrl;
      params.partition = BROWSER_PARTITION;

      this.applySecureWebPreferences(webPreferences);
    });

    webContents.once('destroyed', () => {
      this.ownerWebContentsIds.delete(webContents.id);
    });
  }

  private applySecureWebPreferences(webPreferences: WebPreferences): void {
    Object.assign(webPreferences, {
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      partition: BROWSER_PARTITION,
      preload: undefined,
      sandbox: true,
    } satisfies Partial<WebPreferences>);
  }

  private attachPageWebContents(sessionId: string, webContents: WebContents): void {
    const page = this.ensurePage(sessionId);
    page.webContents = webContents;

    webContents.setWindowOpenHandler(({ url }) => {
      // target=_blank links stay inside the sidebar: retarget the current page
      // instead of spawning detached native windows the sidebar can't manage.
      if (HTTP_URL_PATTERN.test(url)) {
        webContents.loadURL(url).catch((error) => {
          logger.error(`Failed to open URL in browser sidebar: ${url}`, error);
        });
      }

      return { action: 'deny' };
    });

    const update = () => this.updateSnapshot(sessionId);

    webContents.on('page-title-updated', update);
    webContents.on('did-start-loading', () => {
      page.isLoading = true;
      this.updateSnapshot(sessionId);
    });
    webContents.on('did-stop-loading', () => {
      page.isLoading = false;
      this.updateSnapshot(sessionId);
    });
    webContents.on('did-navigate', update);
    webContents.on('did-navigate-in-page', update);
    webContents.on('did-redirect-navigation', update);
    webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        page.error = errorDescription;
        page.url = validatedURL || page.url;
        page.isLoading = false;
        this.broadcastState(sessionId);
      },
    );
    webContents.once('destroyed', () => {
      if (page.webContents?.id === webContents.id) {
        page.webContents = undefined;
        page.isLoading = false;
        this.broadcastState(sessionId);
      }
    });
    webContents.on('render-process-gone', (_event, details) => {
      page.error = details.reason;
      page.isLoading = false;
      this.broadcastState(sessionId);
    });

    this.updateSnapshot(sessionId);
  }

  private configureBrowserSession(): void {
    if (this.partitionConfigured) return;

    const browserSession = electronSession.fromPartition(BROWSER_PARTITION);

    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on('will-download', (event) => {
      event.preventDefault();
    });
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      if (details.resourceType === 'mainFrame' && !isSupportedNavigationUrl(details.url)) {
        callback({ cancel: true });
        return;
      }

      callback({});
    });

    this.partitionConfigured = true;
  }

  private ensurePage(sessionId: string): BrowserPageRecord {
    const current = this.pages.get(sessionId);
    if (current) return current;

    const page: BrowserPageRecord = {
      isLoading: false,
      sessionId,
      title: '',
      url: DEFAULT_BROWSER_URL,
    };
    this.pages.set(sessionId, page);
    return page;
  }

  private getLiveWebContents(sessionId: string): WebContents | undefined {
    const webContents = this.pages.get(sessionId)?.webContents;
    if (!webContents || webContents.isDestroyed()) return undefined;
    return webContents;
  }

  /** Guest accessor for sibling controllers (BrowserControlCtr drives it). */
  getSessionWebContents(sessionId: string): WebContents | undefined {
    return this.getLiveWebContents(sessionId);
  }

  private snapshot(sessionId: string): BrowserSidebarState {
    const page = this.ensurePage(sessionId);
    const webContents = this.getLiveWebContents(sessionId);

    return {
      attached: !!webContents,
      canGoBack: webContents?.canGoBack() ?? false,
      canGoForward: webContents?.canGoForward() ?? false,
      error: page.error,
      isLoading: webContents?.isLoading() ?? page.isLoading,
      sessionId,
      title: webContents?.getTitle() || page.title,
      url: webContents?.getURL() || page.url,
    };
  }

  private updateSnapshot(sessionId: string): void {
    const page = this.ensurePage(sessionId);
    const webContents = this.getLiveWebContents(sessionId);

    if (webContents) {
      page.title = webContents.getTitle();
      page.url = webContents.getURL() || page.url;
      page.isLoading = webContents.isLoading();
      page.error = undefined;
    }

    this.broadcastState(sessionId);
  }

  private broadcastState(sessionId: string): void {
    this.app.browserManager.broadcastToAllWindows(
      'browserSidebarStateChanged',
      this.snapshot(sessionId),
    );
  }

  private async withPageWebContents(
    sessionId: string,
    action: (webContents: WebContents) => BrowserSidebarResult | Promise<BrowserSidebarResult>,
  ): Promise<BrowserSidebarResult> {
    const webContents = this.getLiveWebContents(sessionId);
    if (!webContents) return { error: 'Browser is not ready', success: false };

    return action(webContents);
  }
}
