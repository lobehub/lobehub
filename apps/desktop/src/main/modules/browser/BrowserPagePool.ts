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

/**
 * Every live page is a full renderer process — measured at 90–345 MB each, so an
 * unbounded pool would trade the old `<webview>` design's single page for
 * gigabytes. Pages past this count get discarded (their URL is remembered and
 * reloaded on next use), oldest-idle first.
 *
 * Sessions are keyed per topic (and, later, per tab), so a single agent can hold
 * several pages at once — hence the headroom over the original per-agent cap.
 */
export const MAX_LIVE_PAGES = 10;
/**
 * A page an agent touched this recently is treated as in use and never discarded
 * mid-run, even over the cap: breaking a running automation is far worse than
 * holding one more process.
 */
const IN_USE_MS = 90_000;
/**
 * Eviction has to be a sweep, not just a create-time check: a burst of agents all
 * opening pages at once leaves nothing evictable (everything is "in use"), and if
 * no further page is ever created, the pool would sit over the cap forever.
 */
const SWEEP_MS = 30_000;

export interface BrowserPage {
  error?: string;
  faviconUrl?: string;
  /**
   * The window currently showing this page. `undefined` means it sits in the
   * parking window — never "attached to nothing", which would kill the surface.
   */
  host?: BrowserWindow;
  isLoading: boolean;
  /** Last time the user or an agent did anything with this page (for eviction). */
  lastUsedAt: number;
  sessionId: string;
  /** Viewport the page is laid out at; preserved across parking so refs stay valid. */
  size: { height: number; width: number };
  title: string;
  url: string;
  view: WebContentsView;
}

interface BrowserPagePoolOptions {
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
  /**
   * Which page each window is showing. Per-window, not global: the agent route
   * also renders in standalone `chatSingle` windows, so two windows can each
   * show a page of their own at the same time.
   */
  private displayedByWindow = new Map<number, string>();
  /**
   * The last page each window asked to show, kept even after another window takes
   * that page away. A page can only live in one window, so when the same session
   * is open twice the loser's panel would otherwise sit empty forever: its rect
   * never changes, so its renderer never re-reports. Replaying this on window
   * focus makes the page follow whichever window you are actually looking at.
   */
  private lastRequestByWindow = new Map<number, { rect: Rectangle; sessionId: string }>();
  private watchedWindows = new Set<number>();
  /**
   * URLs of pages discarded by the cap. The session keeps looking like it has a
   * page (the panel still shows its address), and the next use rebuilds the view
   * on the same URL — a reload, not a silent reset to blank.
   */
  private discarded = new Map<string, { faviconUrl?: string; title: string; url: string }>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(private options: BrowserPagePoolOptions) {}

  get(sessionId: string): BrowserPage | undefined {
    return this.pages.get(sessionId);
  }

  /** Where a page discarded by the cap left off, so the panel can still show it. */
  discardedRecord(
    sessionId: string,
  ): { faviconUrl?: string; title: string; url: string } | undefined {
    return this.discarded.get(sessionId);
  }

  webContentsOf(sessionId: string): WebContents | undefined {
    const view = this.pages.get(sessionId)?.view;
    if (!view || view.webContents.isDestroyed()) return undefined;
    return view.webContents;
  }

  /** True for the pool's own off-screen window, which must not count as an app window. */
  isParkingWindow(window: BrowserWindow): boolean {
    return !!this.parkingWindow && this.parkingWindow.id === window.id;
  }

  /** Creates the page (parked) if it doesn't exist yet. */
  ensure(sessionId: string): BrowserPage {
    const existing = this.pages.get(sessionId);
    if (existing && !existing.view.webContents.isDestroyed()) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        devTools: true,
        nodeIntegration: false,
        partition: this.options.partition,
        sandbox: true,
      },
    });

    const restored = this.discarded.get(sessionId);
    this.discarded.delete(sessionId);

    const page: BrowserPage = {
      faviconUrl: restored?.faviconUrl,
      isLoading: false,
      lastUsedAt: Date.now(),
      sessionId,
      size: { ...DEFAULT_PAGE_SIZE },
      title: restored?.title ?? '',
      url: restored?.url ?? 'about:blank',
      view,
    };
    this.pages.set(sessionId, page);

    // Born in the parking lot so it holds a live surface from the very first
    // navigation — an agent can drive it before the user ever opens the panel.
    const parking = this.ensureParkingWindow();
    parking.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, ...page.size });

    this.wirePage(page);

    // Coming back to a page the cap discarded reloads it where it left off.
    if (restored && restored.url !== 'about:blank') {
      view.webContents.loadURL(restored.url).catch((error: Error) => {
        logger.debug(`Failed to restore discarded page ${sessionId}: ${error.message}`);
      });
    }

    logger.debug(`Created browser page for ${sessionId}`);
    this.startSweep();
    this.evictColdPages();
    return page;
  }

  private startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.evictColdPages(), SWEEP_MS);
    // Never hold the app open just to run the sweep.
    this.sweepTimer.unref?.();
  }

  /** Record that the page was just used, so the cap discards something colder. */
  touch(sessionId: string): void {
    const page = this.pages.get(sessionId);
    if (page) page.lastUsedAt = Date.now();
  }

  /**
   * Hold the pool to MAX_LIVE_PAGES by discarding the coldest pages. A page that
   * is on screen, or that an agent touched within IN_USE_MS, is never a candidate
   * — we would rather sit over the cap than kill a page mid-automation.
   */
  private evictColdPages(): void {
    while (this.pages.size > MAX_LIVE_PAGES) {
      const now = Date.now();
      const candidates = [...this.pages.values()]
        .filter((page) => !page.host && now - page.lastUsedAt > IN_USE_MS)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

      const coldest = candidates[0];
      if (!coldest) {
        logger.debug(
          `${this.pages.size} browser pages live, all in use — staying over the cap of ${MAX_LIVE_PAGES}`,
        );
        return;
      }

      logger.debug(`Discarding cold browser page ${coldest.sessionId} (${coldest.url})`);
      this.discarded.set(coldest.sessionId, {
        faviconUrl: coldest.faviconUrl,
        title: coldest.title,
        url: coldest.url,
      });
      this.close(coldest.sessionId);
      this.options.onPageChanged(coldest.sessionId);
    }
  }

  /**
   * Show the page inside `host` at `rect`. `host` is the window that reported the
   * rect — the agent route renders in standalone windows too, so hard-coding the
   * main window would place the view over the wrong one.
   */
  show(sessionId: string, rect: Rectangle, host: BrowserWindow): void {
    if (host.isDestroyed()) return;

    const page = this.ensure(sessionId);

    // One page per window: whatever this window was showing goes back to parking.
    const previous = this.displayedByWindow.get(host.id);
    if (previous && previous !== sessionId) this.park(previous);

    if (page.host?.id !== host.id) {
      this.detach(page);
      host.contentView.addChildView(page.view);
      page.host = host;
      this.watchHost(host);
    }

    // The renderer measures in CSS px but `setBounds` takes DIP, and the two only
    // agree at zoom factor 1 — the old <webview> was laid out by CSS and followed
    // the zoom for free, a view has to be scaled by hand or it drifts off the panel.
    const zoom = host.webContents.getZoomFactor() || 1;
    const bounds: Rectangle = {
      height: Math.max(1, Math.round(rect.height * zoom)),
      width: Math.max(1, Math.round(rect.width * zoom)),
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
    };

    page.view.setBounds(bounds);
    page.size = clampToParking({ height: bounds.height, width: bounds.width });
    this.displayedByWindow.set(host.id, sessionId);
    this.lastRequestByWindow.set(host.id, { rect, sessionId });
  }

  /** The window's panel no longer wants a page (another tab, or the panel closed). */
  hide(sessionId: string, host?: BrowserWindow): void {
    if (host) this.lastRequestByWindow.delete(host.id);
    this.park(sessionId);
  }

  /** Move the page back to the off-screen window, where it keeps running. */
  park(sessionId: string): void {
    const page = this.pages.get(sessionId);
    if (!page || page.view.webContents.isDestroyed() || !page.host) return;

    this.detach(page);
    const parking = this.ensureParkingWindow();
    parking.contentView.addChildView(page.view);
    page.view.setBounds({ x: 0, y: 0, ...page.size });
  }

  close(sessionId: string): void {
    const page = this.pages.get(sessionId);
    if (!page) return;

    this.detach(page);
    this.pages.delete(sessionId);
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close();
  }

  /**
   * Tear everything down. The parking window is a real BrowserWindow, so leaving
   * it alive would suppress `window-all-closed` and keep the app from quitting on
   * Windows/Linux.
   */
  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    for (const sessionId of this.pages.keys()) this.close(sessionId);
    if (this.parkingWindow && !this.parkingWindow.isDestroyed()) this.parkingWindow.destroy();
    this.parkingWindow = undefined;
    this.displayedByWindow.clear();
    this.watchedWindows.clear();
  }

  /** Take the view out of whichever window holds it, leaving it attached to nothing. */
  private detach(page: BrowserPage): void {
    if (page.host) {
      if (!page.host.isDestroyed()) page.host.contentView.removeChildView(page.view);
      if (this.displayedByWindow.get(page.host.id) === page.sessionId) {
        this.displayedByWindow.delete(page.host.id);
      }
      page.host = undefined;
      return;
    }

    if (this.parkingWindow && !this.parkingWindow.isDestroyed()) {
      this.parkingWindow.contentView.removeChildView(page.view);
    }
  }

  private watchHost(host: BrowserWindow): void {
    if (this.watchedWindows.has(host.id)) return;
    this.watchedWindows.add(host.id);

    /**
     * Child views are destroyed with the window that holds them, so a page shown
     * in a standalone chat window would die with it. Park on `close` (which fires
     * *before* teardown) to keep the page — and any agent still driving it — alive.
     */
    host.once('close', () => {
      this.watchedWindows.delete(host.id);
      this.lastRequestByWindow.delete(host.id);
      for (const page of this.pages.values()) {
        if (page.host?.id === host.id) this.park(page.sessionId);
      }
    });

    // Reclaim the page this window last asked for. The renderer's own `focus`
    // event is not a usable signal here: switching between two windows of the
    // same app leaves the previous document reporting `hasFocus() === true` and
    // fires no `focus` on the one you switch to (measured), so a page handed to
    // another window would never come back.
    host.on('focus', () => {
      const request = this.lastRequestByWindow.get(host.id);
      if (!request) return;
      const page = this.pages.get(request.sessionId);
      if (!page || page.host?.id === host.id) return;
      logger.debug(`Reclaiming ${request.sessionId} into window ${host.id} on focus`);
      this.show(request.sessionId, request.rect, host);
    });
  }

  private ensureParkingWindow(): BrowserWindow {
    if (this.parkingWindow && !this.parkingWindow.isDestroyed()) return this.parkingWindow;

    const win = new BrowserWindow({
      closable: false,
      focusable: false,
      frame: false,
      hasShadow: false,
      height: PARKING_SIZE.height,
      // Invisibility comes from opacity, NOT from `show: false` — a hidden window
      // gives its views no compositing surface, which is the whole problem this
      // window exists to avoid.
      opacity: 0,
      show: false,
      skipTaskbar: true,
      width: PARKING_SIZE.width,
      x: PARKING_ORIGIN.x,
      y: PARKING_ORIGIN.y,
    });

    win.setIgnoreMouseEvents(true);
    if (process.platform === 'darwin') win.excludedFromShownWindowsMenu = true;

    win.showInactive();
    // Off-display coordinates are only defence in depth: the OS clamps a window
    // it considers reachable (macOS pulled -8000,-8000 back to the screen edge,
    // where a plain white window was visible over the app). `opacity: 0` is what
    // actually makes it invisible, and it keeps the compositing surface alive.
    win.setPosition(PARKING_ORIGIN.x, PARKING_ORIGIN.y);
    win.setOpacity(0);

    this.parkingWindow = win;
    logger.debug('Created transparent off-screen browser parking window');
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
    webContents.on('page-favicon-updated', (_event, favicons) => {
      page.faviconUrl = favicons[0];
      changed();
    });
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
