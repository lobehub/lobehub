import type {
  BrowserSidebarImportResult,
  BrowserSidebarNavigateParams,
  BrowserSidebarOverlayLabelsParams,
  BrowserSidebarResult,
  BrowserSidebarSessionParams,
  BrowserSidebarState,
  BrowserSidebarViewportParams,
} from '@lobechat/electron-client-ipc';
import type { BrowserWindow, WebContents } from 'electron';
import {
  app as electronApp,
  BrowserWindow as ElectronBrowserWindow,
  clipboard,
  session as electronSession,
  shell,
} from 'electron';

import type { AgentOverlayLabels } from '@/modules/browser/agentOverlayScript';
import { BrowserPagePool } from '@/modules/browser/BrowserPagePool';
import { importChromeLoginData } from '@/modules/browser/importChromeLoginData';
import { getIpcContext } from '@/utils/ipc/base';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:BrowserSidebarCtr');

/**
 * Shared persistent profile: logins/cookies survive across agents and restarts,
 * mirroring a regular browser.
 */
const BROWSER_PARTITION = 'persist:lobe-browser-app';
const DEFAULT_BROWSER_URL = 'about:blank';
const HTTP_URL_PATTERN = /^https?:\/\//i;
const LOCAL_URL_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#].*)?$/i;
const SUPPORTED_PROTOCOLS = new Set(['about:', 'http:', 'https:']);

const DEFAULT_OVERLAY_LABELS: AgentOverlayLabels = {
  controlling: 'Agent is controlling this page',
  cursor: 'Agent',
};

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

/**
 * Owns the in-app browser pages. Each page is a main-process `WebContentsView`,
 * not a renderer `<webview>`: page lifetime must not depend on a React component
 * being mounted, otherwise a background agent has no page of its own and its
 * `navigate` ends up hijacking whichever page the user is looking at.
 *
 * The renderer only reports where the panel is on screen (`setViewport`); the
 * pool hosts the matching view in the window that reported it.
 */
export default class BrowserSidebarCtr extends ControllerModule {
  static override readonly groupName = 'browserSidebar';

  private partitionConfigured = false;
  private pagePool?: BrowserPagePool;
  private overlayLabels: AgentOverlayLabels = DEFAULT_OVERLAY_LABELS;

  beforeAppReady() {
    electronApp.on('before-quit', () => this.disposePool());

    // The parking window is a real BrowserWindow, so while it is alive the app
    // never sees `window-all-closed` — and never quits on Windows/Linux. Tear the
    // pool down once the last app window has gone.
    electronApp.on('browser-window-created', (_event, window) => {
      window.once('closed', () => {
        if (!this.pagePool) return;
        const appWindows = ElectronBrowserWindow.getAllWindows().filter(
          (candidate) => !candidate.isDestroyed() && !this.pagePool!.isParkingWindow(candidate),
        );
        if (appWindows.length === 0) this.disposePool();
      });
    });
  }

  @IpcMethod()
  captureScreenshotToClipboard(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPage(params.sessionId, async (webContents) => {
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
    return this.withPage(params.sessionId, (webContents) => {
      if (!webContents.canGoBack()) return { success: false };
      webContents.goBack();
      return { success: true };
    });
  }

  @IpcMethod()
  goForward(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPage(params.sessionId, (webContents) => {
      if (!webContents.canGoForward()) return { success: false };
      webContents.goForward();
      return { success: true };
    });
  }

  /**
   * Creates the page if this session doesn't have one yet, so an agent can drive
   * a page the user has never opened — no UI round-trip, no waiting for a mount.
   */
  @IpcMethod()
  async navigate(params: BrowserSidebarNavigateParams): Promise<BrowserSidebarResult> {
    const url = normalizeBrowserUrl(params.url);
    if (!isSupportedNavigationUrl(url)) {
      return { error: `Unsupported URL: ${url}`, success: false };
    }

    const page = this.pool.ensure(params.sessionId);
    page.url = url;
    page.error = undefined;

    await page.view.webContents.loadURL(url).catch((error: Error) => {
      // A superseded navigation rejects here; the did-fail-load handler already
      // records anything worth surfacing.
      logger.debug(`Navigation to ${url} did not settle cleanly: ${error.message}`);
    });

    this.updateSnapshot(params.sessionId);
    return { success: true };
  }

  @IpcMethod()
  openExternal(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPage(params.sessionId, async (webContents) => {
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
    return this.withPage(params.sessionId, (webContents) => {
      webContents.reload();
      return { success: true };
    });
  }

  @IpcMethod()
  stop(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.withPage(params.sessionId, (webContents) => {
      webContents.stop();
      return { success: true };
    });
  }

  /**
   * The renderer reports the panel rect (in its own window's coordinates) on every
   * layout change; a missing/degenerate rect means "nobody is looking at this
   * page", which parks it rather than destroying it.
   *
   * The rect is hosted in the *sender's* window, not the main one: the agent route
   * also renders in standalone `chatSingle` windows, and placing the view in the
   * main window would leave the standalone panel blank and paint the page over the
   * wrong window.
   */
  @IpcMethod()
  setViewport(params: BrowserSidebarViewportParams): BrowserSidebarResult {
    const { rect, sessionId } = params;
    const host = this.getSenderWindow();

    if (!rect || rect.width < 1 || rect.height < 1 || !host) {
      this.pool.hide(sessionId, host);
      return { success: true };
    }

    this.pool.show(sessionId, rect, host);
    return { success: true };
  }

  /** The overlay is drawn inside the page, so its copy has to come from the renderer. */
  @IpcMethod()
  setOverlayLabels(params: BrowserSidebarOverlayLabelsParams): BrowserSidebarResult {
    this.overlayLabels = { controlling: params.controlling, cursor: params.cursor };
    return { success: true };
  }

  /** Accessors for sibling controllers (BrowserControlCtr drives the pages). */
  getSessionWebContents(sessionId: string): WebContents | undefined {
    return this.pagePool?.webContentsOf(sessionId);
  }

  /** Mark a page as in use so the memory cap doesn't discard it mid-automation. */
  touchPage(sessionId: string): void {
    this.pagePool?.touch(sessionId);
  }

  getOverlayLabels(): AgentOverlayLabels {
    return this.overlayLabels;
  }

  private get pool(): BrowserPagePool {
    if (this.pagePool) return this.pagePool;

    this.configureBrowserSession();
    this.pagePool = new BrowserPagePool({
      onPageChanged: (sessionId) => this.updateSnapshot(sessionId),
      partition: BROWSER_PARTITION,
    });

    return this.pagePool;
  }

  private disposePool(): void {
    this.pagePool?.dispose();
    this.pagePool = undefined;
  }

  /** The window whose renderer made the current IPC call. */
  private getSenderWindow(): BrowserWindow | undefined {
    const sender = getIpcContext()?.sender;
    if (!sender || sender.isDestroyed()) return undefined;
    return ElectronBrowserWindow.fromWebContents(sender) ?? undefined;
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

  private snapshot(sessionId: string): BrowserSidebarState {
    const page = this.pagePool?.get(sessionId);
    const webContents = this.getSessionWebContents(sessionId);
    // A page the pool discarded to stay under its memory cap still reports its
    // URL, so the panel keeps showing it and the next visit reloads it there
    // rather than dropping the user on a blank pane.
    const discarded = this.pagePool?.discardedRecord(sessionId);

    return {
      attached: !!webContents,
      canGoBack: webContents?.canGoBack() ?? false,
      canGoForward: webContents?.canGoForward() ?? false,
      error: page?.error,
      isLoading: webContents?.isLoading() ?? page?.isLoading ?? false,
      sessionId,
      title: webContents?.getTitle() || page?.title || discarded?.title || '',
      url: webContents?.getURL() || page?.url || discarded?.url || DEFAULT_BROWSER_URL,
    };
  }

  private updateSnapshot(sessionId: string): void {
    const page = this.pagePool?.get(sessionId);
    const webContents = this.getSessionWebContents(sessionId);

    if (page && webContents) {
      page.title = webContents.getTitle();
      page.url = webContents.getURL() || page.url;
      page.isLoading = webContents.isLoading();
    }

    this.app.browserManager.broadcastToAllWindows(
      'browserSidebarStateChanged',
      this.snapshot(sessionId),
    );
  }

  private async withPage(
    sessionId: string,
    action: (webContents: WebContents) => BrowserSidebarResult | Promise<BrowserSidebarResult>,
  ): Promise<BrowserSidebarResult> {
    const webContents = this.getSessionWebContents(sessionId);
    if (!webContents) return { error: 'Browser is not ready', success: false };

    return action(webContents);
  }
}
