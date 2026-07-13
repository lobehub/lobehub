import type { Rectangle, WebContents } from 'electron';
import { BrowserWindow, WebContentsView } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:browser:BrowserPagePool');

/**
 * A page keeps working `capturePage()` / `sendInputEvent()` only while its view
 * is attached to a window that is *shown*. Detaching the view, `setVisible(false)`,
 * moving its bounds outside the window rect, or parking it in a `show: false`
 * window all drop the compositing surface — capture then throws `UnknownVizError`,
 * and (worse) a just-detached view keeps answering with a STALE frame for a while.
 *
 * So a page that nobody is looking at is not hidden; it is moved to a real,
 * shown window that simply sits off every display. Occlusion is fine: a view
 * covered by a sibling keeps rendering, which is why parked pages can stack.
 */
const PARKING_ORIGIN = { x: -8000, y: -8000 };
const PARKING_SIZE = { height: 1200, width: 1920 };
const DEFAULT_PAGE_SIZE = { height: 800, width: 1200 };

export interface BrowserPage {
  error?: string;
  isLoading: boolean;
  /** Which window currently hosts the view. Never 'none' — that would kill the surface. */
  location: 'main' | 'parking';
  sessionId: string;
  /** Viewport the page is laid out at; preserved across parking so refs stay valid. */
  size: { height: number; width: number };
  title: string;
  url: string;
  view: WebContentsView;
}

interface BrowserPagePoolOptions {
  getMainWindow: () => BrowserWindow | undefined;
  /** Called whenever a page's observable state (url/title/loading/error) changes. */
  onPageChanged: (sessionId: string) => void;
  /** Hardened persistent partition the pages live in. */
  partition: string;
}

const HTTP_URL_PATTERN = /^https?:\/\//i;

const clampToParking = (size: { height: number; width: number }) => ({
  height: Math.max(1, Math.min(size.height, PARKING_SIZE.height)),
  width: Math.max(1, Math.min(size.width, PARKING_SIZE.width)),
});

export class BrowserPagePool {
  private pages = new Map<string, BrowserPage>();
  private parkingWindow?: BrowserWindow;
  private displayedSessionId?: string;

  constructor(private options: BrowserPagePoolOptions) {}

  has(sessionId: string): boolean {
    return this.pages.has(sessionId);
  }

  get(sessionId: string): BrowserPage | undefined {
    return this.pages.get(sessionId);
  }

  webContentsOf(sessionId: string): WebContents | undefined {
    const view = this.pages.get(sessionId)?.view;
    if (!view || view.webContents.isDestroyed()) return undefined;
    return view.webContents;
  }

  /** Creates the page (parked) if it doesn't exist yet. */
  ensure(sessionId: string): BrowserPage {
    const existing = this.pages.get(sessionId);
    if (existing && !existing.view.webContents.isDestroyed()) return existing;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        devTools: true,
        nodeIntegration: false,
        partition: this.options.partition,
        sandbox: true,
      },
    });

    const page: BrowserPage = {
      isLoading: false,
      location: 'parking',
      sessionId,
      size: { ...DEFAULT_PAGE_SIZE },
      title: '',
      url: 'about:blank',
      view,
    };
    this.pages.set(sessionId, page);

    // Born in the parking lot so it holds a live surface from the very first
    // navigation — an agent can drive it before the user ever opens the panel.
    const parking = this.ensureParkingWindow();
    parking.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, ...page.size });

    this.wirePage(page);
    logger.debug(`Created browser page for ${sessionId}`);
    return page;
  }

  /** Show the page in the main window at `rect`; parks whatever was displayed before. */
  show(sessionId: string, rect: Rectangle): void {
    const main = this.options.getMainWindow();
    if (!main || main.isDestroyed()) return;

    const page = this.ensure(sessionId);

    if (this.displayedSessionId && this.displayedSessionId !== sessionId) {
      this.park(this.displayedSessionId);
    }

    // The renderer measures in CSS px but `setBounds` takes DIP, and the two only
    // agree at zoom factor 1 — the old <webview> was laid out by CSS and followed
    // the zoom for free, a view has to be scaled by hand or it drifts off the panel.
    const zoom = main.webContents.getZoomFactor() || 1;
    const bounds: Rectangle = {
      height: Math.max(1, Math.round(rect.height * zoom)),
      width: Math.max(1, Math.round(rect.width * zoom)),
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
    };

    if (page.location !== 'main') {
      this.parkingWindow?.contentView.removeChildView(page.view);
      main.contentView.addChildView(page.view);
      page.location = 'main';
    }

    page.view.setBounds(bounds);
    page.size = clampToParking({ height: bounds.height, width: bounds.width });
    this.displayedSessionId = sessionId;
  }

  /** Move the page back to the off-screen window, where it keeps running. */
  park(sessionId: string): void {
    const page = this.pages.get(sessionId);
    if (!page || page.view.webContents.isDestroyed()) return;
    if (this.displayedSessionId === sessionId) this.displayedSessionId = undefined;
    if (page.location === 'parking') return;

    const main = this.options.getMainWindow();
    if (main && !main.isDestroyed()) main.contentView.removeChildView(page.view);

    const parking = this.ensureParkingWindow();
    parking.contentView.addChildView(page.view);
    page.view.setBounds({ x: 0, y: 0, ...page.size });
    page.location = 'parking';
  }

  close(sessionId: string): void {
    const page = this.pages.get(sessionId);
    if (!page) return;

    this.pages.delete(sessionId);
    if (this.displayedSessionId === sessionId) this.displayedSessionId = undefined;

    const host =
      page.location === 'main'
        ? this.options.getMainWindow()
        : (this.parkingWindow as BrowserWindow);
    if (host && !host.isDestroyed()) host.contentView.removeChildView(page.view);
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close();
  }

  /**
   * Tear everything down. The parking window is a real BrowserWindow, so leaving
   * it alive would suppress `window-all-closed` and keep the app from quitting on
   * Windows/Linux.
   */
  dispose(): void {
    for (const sessionId of this.pages.keys()) this.close(sessionId);
    if (this.parkingWindow && !this.parkingWindow.isDestroyed()) this.parkingWindow.destroy();
    this.parkingWindow = undefined;
    this.displayedSessionId = undefined;
  }

  private ensureParkingWindow(): BrowserWindow {
    if (this.parkingWindow && !this.parkingWindow.isDestroyed()) return this.parkingWindow;

    const win = new BrowserWindow({
      closable: false,
      focusable: false,
      frame: false,
      height: PARKING_SIZE.height,
      show: false,
      skipTaskbar: true,
      width: PARKING_SIZE.width,
      x: PARKING_ORIGIN.x,
      y: PARKING_ORIGIN.y,
    });

    win.setIgnoreMouseEvents(true);
    if (process.platform === 'darwin') win.excludedFromShownWindowsMenu = true;
    // Must be *shown* — a `show: false` window gives its views no compositing
    // surface. Off-display coordinates are what make it invisible.
    win.showInactive();
    win.setPosition(PARKING_ORIGIN.x, PARKING_ORIGIN.y);

    this.parkingWindow = win;
    logger.debug('Created off-screen browser parking window');
    return win;
  }

  private wirePage(page: BrowserPage): void {
    const { sessionId, view } = page;
    const { webContents } = view;
    const changed = () => this.options.onPageChanged(sessionId);

    webContents.setWindowOpenHandler(({ url }) => {
      // target=_blank stays inside the panel: retarget this page rather than
      // spawn a native window the panel can't manage. (Real tabs land in PR2.)
      if (HTTP_URL_PATTERN.test(url)) {
        webContents.loadURL(url).catch((error) => {
          logger.error(`Failed to open URL in browser page ${sessionId}: ${url}`, error);
        });
      }
      return { action: 'deny' };
    });

    webContents.on('page-title-updated', changed);
    webContents.on('did-navigate', changed);
    webContents.on('did-navigate-in-page', changed);
    webContents.on('did-redirect-navigation', changed);
    webContents.on('did-start-loading', () => {
      page.isLoading = true;
      // A fresh attempt clears the previous failure; did-fail-load fires after
      // this and will set it again if the new navigation also fails.
      page.error = undefined;
      changed();
    });
    webContents.on('did-stop-loading', () => {
      page.isLoading = false;
      changed();
    });
    webContents.on(
      'did-fail-load',
      (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // -3 is ERR_ABORTED — a superseded navigation, not a failure worth showing.
        if (!isMainFrame || errorCode === -3) return;
        page.error = errorDescription;
        page.url = validatedURL || page.url;
        page.isLoading = false;
        changed();
      },
    );
    webContents.on('render-process-gone', (_e, details) => {
      page.error = details.reason;
      page.isLoading = false;
      changed();
    });
  }
}
