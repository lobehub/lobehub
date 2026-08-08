import type {
  BrowserSidebarCaptureResult,
  BrowserSidebarImportResult,
  BrowserSidebarNavigateParams,
  BrowserSidebarOverlayLabelsParams,
  BrowserSidebarPickedElement,
  BrowserSidebarPickElementParams,
  BrowserSidebarPickElementResult,
  BrowserSidebarRegisterWebviewParams,
  BrowserSidebarResult,
  BrowserSidebarSessionParams,
  BrowserSidebarState,
} from '@lobechat/electron-client-ipc';
import type { WebContents } from 'electron';
import { session as electronSession, shell, webContents as electronWebContents } from 'electron';

import type { AgentOverlayLabels } from '@/modules/browser/agentOverlayScript';
import type { PickedElementPayload } from '@/modules/browser/elementPickerScript';
import {
  ELEMENT_PICKER_CANCEL_SCRIPT,
  elementPickerScript,
} from '@/modules/browser/elementPickerScript';
import { importChromeLoginData } from '@/modules/browser/importChromeLoginData';
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

/**
 * Wide enough that page text stays legible for the model, while keeping a
 * Retina-sized capture from becoming a multi-megabyte attachment.
 */
const CAPTURE_MAX_WIDTH = 2000;

/** Element-chip thumbnails ride inside the context selection — keep them small. */
const ELEMENT_THUMBNAIL_MAX_WIDTH = 480;

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
 * Owns the privileged operations for renderer-retained `<webview>` guests.
 * The renderer keeps each guest mounted in either the visible browser pane or
 * an off-screen host; the main process registers its WebContents so agent tools
 * can continue driving it without coupling page lifetime to the visible pane.
 */
export default class BrowserSidebarCtr extends ControllerModule {
  static override readonly groupName = 'browserSidebar';

  private partitionConfigured = false;
  private pages = new Map<
    string,
    {
      error?: string;
      faviconUrl?: string;
      isLoading: boolean;
      title: string;
      url: string;
      webContentsId: number;
    }
  >();
  private overlayLabels: AgentOverlayLabels = DEFAULT_OVERLAY_LABELS;
  private wiredWebContents = new Set<number>();
  /**
   * Bumped on every cancel, per session. `pickElement` awaits a pre-cancel
   * before injecting its picker, so a `cancelElementPick` (e.g. the pane
   * unmounting) can land in that gap and be consumed by nothing — the fresh
   * picker would then swallow every click with no caller left to stop it.
   * Comparing this counter across the gap lets the pick re-apply such a
   * cancellation after its picker is installed.
   */
  private pickCancelSeqs = new Map<string, number>();

  afterAppReady() {
    this.configureBrowserSession();
  }

  /** One-shot capture of the visible page, returned as a data URL so the renderer can attach it to the chat input. */
  @IpcMethod()
  captureScreenshot(params: BrowserSidebarSessionParams): Promise<BrowserSidebarCaptureResult> {
    return this.withPage(params.sessionId, async (webContents) => {
      let image = await webContents.capturePage();
      if (image.getSize().width > CAPTURE_MAX_WIDTH) {
        image = image.resize({ width: CAPTURE_MAX_WIDTH });
      }

      return {
        dataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`,
        success: true,
        title: webContents.getTitle(),
      };
    });
  }

  /**
   * Starts the in-page element picker and stays pending until the user clicks an
   * element or the pick dies (Escape, restart, navigation). The picker UI lives
   * inside the guest page so it tracks the page DOM and viewport precisely.
   */
  @IpcMethod()
  pickElement(params: BrowserSidebarPickElementParams): Promise<BrowserSidebarPickElementResult> {
    return this.withPage(params.sessionId, async (webContents) => {
      const cancelSeqAtStart = this.pickCancelSeqs.get(params.sessionId) ?? 0;

      // Only one picker per page: restarting replaces the previous run.
      await webContents.executeJavaScript(ELEMENT_PICKER_CANCEL_SCRIPT).catch(() => {});

      // Navigating away destroys the page's JS context, and the picker promise
      // silently dies with it — without this race the IPC call would hang forever.
      let unsubscribe = () => {};
      const aborted = new Promise<null>((resolve) => {
        const onAbort = () => resolve(null);
        webContents.on('did-navigate', onAbort);
        webContents.once('destroyed', onAbort);
        unsubscribe = () => {
          webContents.removeListener('did-navigate', onAbort);
          webContents.removeListener('destroyed', onAbort);
        };
      });

      try {
        const pick = webContents
          .executeJavaScript(elementPickerScript({ hint: params.hint }))
          .catch(() => null);

        // A cancel that arrived during the pre-cancel await was consumed by the
        // OLD picker (or nothing). Re-apply it so it lands AFTER the picker we
        // just injected — executeJavaScript calls run in issue order.
        if ((this.pickCancelSeqs.get(params.sessionId) ?? 0) !== cancelSeqAtStart) {
          void webContents.executeJavaScript(ELEMENT_PICKER_CANCEL_SCRIPT).catch(() => {});
        }

        const raw = await Promise.race([pick, aborted]);
        if (typeof raw !== 'string') return { cancelled: true, success: true };

        const payload = JSON.parse(raw) as PickedElementPayload;
        if (payload.cancelled) return { cancelled: true, success: true };

        const element: BrowserSidebarPickedElement = {
          html: payload.html ?? '',
          pageTitle: webContents.getTitle(),
          rect: payload.rect,
          selector: payload.selector ?? '',
          tag: payload.tag ?? '',
          text: payload.text ?? '',
          thumbnailUrl: await this.captureElementThumbnail(webContents, payload),
          url: webContents.getURL(),
        };
        return { element, success: true };
      } finally {
        unsubscribe();
      }
    });
  }

  /**
   * Crop the picked element out of the page so its chip can show the real thing.
   * Best-effort: any failure (element off-screen, capture race, teardown) just
   * yields no thumbnail — the pick itself already succeeded.
   */
  private async captureElementThumbnail(
    webContents: WebContents,
    payload: PickedElementPayload,
  ): Promise<string | undefined> {
    const { rect, viewport } = payload;
    if (!rect || !viewport) return undefined;

    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const width = Math.floor(Math.min(rect.x + rect.width, viewport.width) - x);
    const height = Math.floor(Math.min(rect.y + rect.height, viewport.height) - y);
    if (width < 4 || height < 4) return undefined;

    try {
      // The picker removes its overlay right before resolving; give the
      // compositor a frame so the crop doesn't contain the highlight box.
      await new Promise((resolve) => setTimeout(resolve, 80));

      let image = await webContents.capturePage({ height, width, x, y });
      if (image.isEmpty()) return undefined;
      if (image.getSize().width > ELEMENT_THUMBNAIL_MAX_WIDTH) {
        image = image.resize({ width: ELEMENT_THUMBNAIL_MAX_WIDTH });
      }

      return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
    } catch (error) {
      logger.debug(`Element thumbnail capture failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  @IpcMethod()
  cancelElementPick(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    this.pickCancelSeqs.set(params.sessionId, (this.pickCancelSeqs.get(params.sessionId) ?? 0) + 1);

    return this.withPage(params.sessionId, async (webContents) => {
      await webContents.executeJavaScript(ELEMENT_PICKER_CANCEL_SCRIPT).catch(() => {});
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

    const page = this.pages.get(params.sessionId);
    const webContents = this.getSessionWebContents(params.sessionId);
    if (!page || !webContents) return { error: 'Browser is not ready', success: false };

    page.url = url;
    page.error = undefined;

    await webContents.loadURL(url).catch((error: Error) => {
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

  /** Register (or activate) the retained guest owned by the calling renderer. */
  @IpcMethod()
  registerWebview(params: BrowserSidebarRegisterWebviewParams): BrowserSidebarResult {
    const webContents = electronWebContents.fromId(params.webContentsId);
    if (!webContents || webContents.isDestroyed()) {
      return { error: 'Browser webview is not ready', success: false };
    }

    const previous = this.pages.get(params.sessionId);
    this.pages.set(params.sessionId, {
      error: previous?.error,
      faviconUrl: previous?.faviconUrl,
      isLoading: webContents.isLoading(),
      title: webContents.getTitle() || previous?.title || '',
      url: webContents.getURL() || previous?.url || DEFAULT_BROWSER_URL,
      webContentsId: params.webContentsId,
    });
    this.wirePage(params.sessionId, webContents);
    this.updateSnapshot(params.sessionId);
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
    const page = this.pages.get(sessionId);
    if (!page) return undefined;
    const webContents = electronWebContents.fromId(page.webContentsId);
    return webContents && !webContents.isDestroyed() ? webContents : undefined;
  }

  getOverlayLabels(): AgentOverlayLabels {
    return this.overlayLabels;
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
    const page = this.pages.get(sessionId);
    const webContents = this.getSessionWebContents(sessionId);

    return {
      attached: !!webContents,
      canGoBack: webContents?.canGoBack() ?? false,
      canGoForward: webContents?.canGoForward() ?? false,
      error: page?.error,
      faviconUrl: page?.faviconUrl,
      isLoading: webContents?.isLoading() ?? page?.isLoading ?? false,
      sessionId,
      title: webContents?.getTitle() || page?.title || '',
      url: webContents?.getURL() || page?.url || DEFAULT_BROWSER_URL,
    };
  }

  private updateSnapshot(sessionId: string): void {
    const page = this.pages.get(sessionId);
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

  private wirePage(sessionId: string, webContents: WebContents): void {
    if (this.wiredWebContents.has(webContents.id)) return;
    this.wiredWebContents.add(webContents.id);

    const changed = () => this.updateSnapshot(sessionId);
    webContents.setWindowOpenHandler(({ url }) => {
      if (HTTP_URL_PATTERN.test(url)) {
        void webContents.loadURL(url).catch((error) => {
          logger.error(`Failed to open URL in browser page ${sessionId}: ${url}`, error);
        });
      }
      return { action: 'deny' };
    });
    webContents.on('page-title-updated', changed);
    webContents.on('page-favicon-updated', (_event, favicons) => {
      const page = this.pages.get(sessionId);
      if (page) page.faviconUrl = favicons[0];
      changed();
    });
    webContents.on('did-navigate', changed);
    webContents.on('did-navigate-in-page', changed);
    webContents.on('did-start-loading', () => {
      const page = this.pages.get(sessionId);
      if (page) {
        page.error = undefined;
        page.isLoading = true;
      }
      changed();
    });
    webContents.on('did-stop-loading', () => {
      const page = this.pages.get(sessionId);
      if (page) page.isLoading = false;
      changed();
    });
    webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      const page = this.pages.get(sessionId);
      if (page) {
        page.error = description;
        page.isLoading = false;
        page.url = url || page.url;
      }
      changed();
    });
    webContents.once('destroyed', () => {
      this.wiredWebContents.delete(webContents.id);
      if (this.pages.get(sessionId)?.webContentsId === webContents.id) {
        this.pages.delete(sessionId);
        this.updateSnapshot(sessionId);
      }
    });
  }

  private async withPage<T extends BrowserSidebarResult>(
    sessionId: string,
    action: (webContents: WebContents) => T | Promise<T>,
  ): Promise<T> {
    const webContents = this.getSessionWebContents(sessionId);
    if (!webContents) return { error: 'Browser is not ready', success: false } as T;

    return action(webContents);
  }
}
