import { randomUUID } from 'node:crypto';

import type {
  CapturePreviewResult,
  CaptureRectParams,
  OverlayCaptureUploadStatus,
  OverlayCaptureUploadStatusPayload,
  ScreenCaptureAgentOption,
  ScreenCaptureModelOption,
  ScreenCaptureOverlayTheme,
  ScreenCaptureSession,
  ScreenCaptureSubmitParams,
} from '@lobechat/electron-client-ipc';
import type { CaptureFailure } from '@lobechat/electron-mac-screen-capture';
import { BrowserWindow, dialog, screen } from 'electron';

import { BrowsersIdentifiers } from '@/appBrowsers';
import { preloadDir } from '@/const/dir';
import { isMac } from '@/const/env';
import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';
import { getScreenCaptureStatus, requestScreenCaptureAccess } from '@/utils/permissions';

import { captureRect, captureWindow } from './CaptureService';
import { enumerateWindows } from './WindowSourceService';

const logger = createLogger('screenCapture:ScreenCaptureManager');

const HIDE_SETTLE_MS = 40;
// macOS 15+ raises a one-time "allow direct capture" consent for ScreenCaptureKit.
// The overlay must not open on top of it, and an ignored dialog must not hang the
// shortcut, so the wait is bounded.
const CAPTURE_CONSENT_POLL_MS = 250;
const CAPTURE_CONSENT_TIMEOUT_MS = 10_000;

export { CAPTURE_CONSENT_POLL_MS, CAPTURE_CONSENT_TIMEOUT_MS };

export interface OverlaySnapshotPayload {
  agents?: ScreenCaptureAgentOption[];
  defaultAgentId?: string;
  defaultModelId?: string;
  defaultProvider?: string;
  models?: ScreenCaptureModelOption[];
  theme?: ScreenCaptureOverlayTheme;
}

interface CaptureUploadEntry {
  fileId?: string;
  filename: string;
  status: OverlayCaptureUploadStatus;
}

export class ScreenCaptureManager {
  private overlayWindow: BrowserWindow | null = null;
  private session: ScreenCaptureSession | null = null;
  /**
   * Most recent agent/model snapshot published by the main renderer via
   * `screenCapture.publishOverlaySnapshot`. Populated asynchronously; the
   * overlay still opens with an empty selector list if the renderer has not
   * pushed yet.
   */
  private snapshot: OverlaySnapshotPayload = {};
  /**
   * Per-capture upload state used to drive the overlay send button and to
   * resolve captureIds back to uploaded fileIds on submit. Cleared when the
   * session closes.
   */
  private captureUploads = new Map<string, CaptureUploadEntry>();
  /**
   * The status query is a live XPC round trip to tccd, so the overlay defers it
   * to capture time rather than paying for it on every open. A granted result
   * only changes if the user revokes it, so caching that is safe; a denied
   * result is never cached, which is what lets a grant made while the app runs
   * start working without a relaunch.
   */
  private screenCaptureGranted = false;
  /**
   * macOS asks for the direct-capture consent once per app, so the probe runs at
   * most once per process.
   */
  private captureConsentEnsured = false;

  constructor(private readonly app: App) {}

  prewarmPermissionCheck(): void {
    if (!isMac || this.screenCaptureGranted) return;
    setTimeout(() => {
      const start = Date.now();
      this.screenCaptureGranted = getScreenCaptureStatus() === 'granted';
      logger.info(
        `Prewarmed screen capture permission: granted=${this.screenCaptureGranted} (${Date.now() - start}ms)`,
      );
    }, 0);
  }

  publishOverlaySnapshot(payload: OverlaySnapshotPayload): void {
    this.snapshot = payload;
    // If a session is already on screen, push the updated lists so the user
    // sees the current agents without reopening the overlay.
    if (this.session) {
      this.session = { ...this.session, ...this.snapshot };
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send('screenCaptureSession', this.session);
      }
    }
  }

  get isActive(): boolean {
    return this.overlayWindow !== null && !this.overlayWindow.isDestroyed();
  }

  /**
   * Open the composer overlay. Screenshots are opt-in, so the permission check
   * and window enumeration are deferred to `beginCapture`.
   */
  async startSession(): Promise<void> {
    if (this.isActive) {
      logger.warn('Capture session already active');
      this.close();
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { bounds, scaleFactor } = display;

    logger.info(
      `Starting composer session on display ${display.id} (${bounds.width}x${bounds.height} @${scaleFactor}x)`,
    );

    this.session = {
      displayBounds: bounds,
      scaleFactor,
      windows: [],
      ...this.snapshot,
    };

    await this.createOverlayWindow(bounds);
  }

  /**
   * ScreenCaptureKit needs a one-time "allow direct capture" consent on macOS 15
   * and newer. Ask for it before the first capture, with the overlay hidden: the
   * overlay sits at screen-saver level and would otherwise cover the system
   * dialog, leaving the user no way to accept it. The wait is bounded so a hover
   * never hangs — an ignored dialog only means the capture fails, exactly as it
   * would have without this.
   */
  private async ensureCaptureConsent(): Promise<void> {
    if (!isMac || this.captureConsentEnsured) return;
    this.captureConsentEnsured = true;

    const deadline = Date.now() + CAPTURE_CONSENT_TIMEOUT_MS;
    for (;;) {
      const started = Date.now();
      const { png, reason } = await this.withOverlayHidden(() =>
        captureRect({ height: 1, width: 1, x: 0, y: 0 }, 1, { height: 1, width: 1, x: 0, y: 0 }),
      );
      if (png) {
        logger.info(`Screen capture consent ready (${Date.now() - started}ms)`);
        return;
      }
      if (reason !== 'denied') {
        logger.warn(`Screen capture consent probe failed: ${reason ?? 'unknown'}`);
        return;
      }
      if (Date.now() >= deadline) {
        logger.warn('Screen capture consent still missing; continuing without it');
        return;
      }
      await delay(CAPTURE_CONSENT_POLL_MS);
    }
  }

  /**
   * Switch the active session into capture mode: verify Screen Recording
   * access, then enumerate on-screen windows for hover hit-testing.
   * Resolves `false` when capture cannot start.
   */
  async beginCapture(): Promise<boolean> {
    if (!this.session) return false;

    const status = this.resolveScreenCaptureStatus();
    if (status !== 'granted') {
      // The overlay sits at screen-saver level and would cover the dialog.
      this.close();
      await this.promptScreenCaptureAccess(status);
      return false;
    }

    await this.ensureCaptureConsent();

    const { displayBounds, scaleFactor } = this.session;
    const windows = await enumerateWindows(displayBounds, scaleFactor);
    // The overlay may have been closed while windows were being enumerated.
    if (!this.session) return false;

    this.session = { ...this.session, windows };
    logger.info(`Capture mode started with ${windows.length} windows`);

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('screenCaptureSession', this.session);
    }

    return true;
  }

  async handlePreviewWindow(windowId: number): Promise<CapturePreviewResult> {
    if (!this.session) {
      return { error: 'no active session', success: false };
    }

    const winInfo = this.session.windows.find((w) => w.windowId === windowId);
    if (!winInfo) {
      return { error: `window ${windowId} not found`, success: false };
    }

    logger.info(`Previewing window ${windowId} (${winInfo.appName})`);
    const captured = await this.withOverlayHidden(() => captureWindow(windowId));
    if (!captured.png) {
      logger.error(`Window ${windowId} capture failed: ${captured.reason ?? 'unknown'}`);
      return { error: this.describeCaptureFailure(captured.reason), success: false };
    }

    const captureId = randomUUID();
    const filename = `screen-capture-${captureId}.png`;
    this.dispatchUpload(captureId, filename, captured.png);

    return {
      captureId,
      dataUrl: `data:image/png;base64,${captured.png.toString('base64')}`,
      rect: {
        height: winInfo.overlayBounds.height,
        width: winInfo.overlayBounds.width,
        x: winInfo.overlayBounds.x,
        y: winInfo.overlayBounds.y,
      },
      success: true,
    };
  }

  /**
   * Preview a rect from the overlay. `params` is in overlay-local DIP
   * (relative to the current display); main translates to absolute before
   * handing to the capture pipeline.
   */
  async handlePreviewRect(params: CaptureRectParams): Promise<CapturePreviewResult> {
    if (!this.session) {
      return { error: 'no active session', success: false };
    }

    const { displayBounds, scaleFactor } = this.session;
    const absolute = {
      height: params.height,
      width: params.width,
      x: params.x + displayBounds.x,
      y: params.y + displayBounds.y,
    };

    logger.info(`Previewing rect (${params.x},${params.y} ${params.width}x${params.height})`);
    const captured = await this.withOverlayHidden(() =>
      captureRect(absolute, scaleFactor, displayBounds),
    );
    if (!captured.png) {
      logger.error(`Rect capture failed: ${captured.reason ?? 'unknown'}`);
      return { error: this.describeCaptureFailure(captured.reason), success: false };
    }

    const captureId = randomUUID();
    const filename = `screen-capture-${captureId}.png`;
    this.dispatchUpload(captureId, filename, captured.png);

    return {
      captureId,
      dataUrl: `data:image/png;base64,${captured.png.toString('base64')}`,
      rect: params,
      success: true,
    };
  }

  /**
   * The overlay only traces this string, so it stays a stable code rather than
   * prose. `denied` while the permission is already granted is the case worth
   * naming: on macOS 15 and newer the first direct capture needs a one-time
   * consent ("bypass the system window picker"), and until the user accepts it
   * ScreenCaptureKit refuses exactly like a refused permission.
   */
  private describeCaptureFailure(reason: CaptureFailure | null): string {
    if (reason !== 'denied') return 'capture failed';
    return this.resolveScreenCaptureStatus() === 'granted'
      ? 'consent-required'
      : 'permission-denied';
  }

  /**
   * Record an upload status update from the main renderer and forward it to
   * the overlay so the send button can reflect live progress.
   */
  reportUploadStatus(payload: OverlayCaptureUploadStatusPayload): void {
    const entry = this.captureUploads.get(payload.captureId);
    if (!entry) {
      logger.warn(`reportUploadStatus for unknown captureId=${payload.captureId}`);
      return;
    }
    entry.status = payload.status;
    if (payload.fileId) entry.fileId = payload.fileId;
    logger.debug(
      `upload status captureId=${payload.captureId} status=${payload.status} fileId=${payload.fileId ?? '-'}`,
    );

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('overlayCaptureUploadStatus', payload);
    }
  }

  async handleSubmit(params: ScreenCaptureSubmitParams): Promise<void> {
    logger.info(
      `Submit capture — promptLen=${params.prompt.length} captureIds=${params.captureIds.length} agentId=${params.agentId ?? '-'} modelId=${params.modelId ?? '-'}`,
    );

    // Close the overlay first so focus transfers cleanly to the main window.
    this.close();

    try {
      this.app.browserManager.showMainWindow();
    } catch (error) {
      logger.error('Failed to show main window on submit:', error);
    }

    this.app.browserManager.broadcastToAllWindows('overlayDispatchMessage', params);
  }

  close(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy();
    }
    this.overlayWindow = null;
    this.session = null;
    this.captureUploads.clear();
    logger.info('Capture session closed');
  }

  /**
   * Fade overlay out via opacity so the capture pipeline sees clean pixels
   * underneath, then restore opacity. Keeping the window alive (as opposed to
   * hide/show) avoids focus/z-order glitches.
   */
  private async withOverlayHidden<T>(task: () => Promise<T>): Promise<T> {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) {
      return task();
    }

    win.setOpacity(0);
    await delay(HIDE_SETTLE_MS);
    try {
      return await task();
    } finally {
      if (!win.isDestroyed()) {
        win.setOpacity(1);
      }
    }
  }

  /**
   * Hand the PNG buffer to the main renderer so the upload pipeline (TRPC +
   * hash dedup + S3) runs there; keep a local entry so the overlay can
   * observe status transitions via reportUploadStatus.
   *
   * The main renderer receives an `ArrayBuffer` via Electron's structured
   * clone, avoiding the ~33% base64 overhead of a dataUrl round-trip.
   */
  private dispatchUpload(captureId: string, filename: string, pngBuffer: Buffer): void {
    this.captureUploads.set(captureId, { filename, status: 'uploading' });

    // Copy into a fresh ArrayBuffer so the IPC structured-clone layer owns
    // the memory outright (Node's Buffer pool can otherwise alias bytes).
    const bytes = new ArrayBuffer(pngBuffer.byteLength);
    new Uint8Array(bytes).set(pngBuffer);

    this.app.browserManager.broadcastToWindow(BrowsersIdentifiers.app, 'overlayUploadRequest', {
      bytes,
      captureId,
      filename,
      mimeType: 'image/png',
    });
  }

  private resolveScreenCaptureStatus(): ReturnType<typeof getScreenCaptureStatus> {
    if (!isMac || this.screenCaptureGranted) return 'granted';

    const status = getScreenCaptureStatus();
    if (status === 'granted') this.screenCaptureGranted = true;
    return status;
  }

  private async promptScreenCaptureAccess(
    status: ReturnType<typeof getScreenCaptureStatus>,
  ): Promise<void> {
    const t = this.app.i18n.ns('dialog');
    const mainWindow = this.app.browserManager.getMainWindow();
    const parentWindow = mainWindow?.browserWindow?.isVisible?.() ? mainWindow.browserWindow : null;
    const options = {
      buttons: [t('screenCaptureAccess.openSettings'), t('screenCaptureAccess.cancel')],
      cancelId: 1,
      defaultId: 0,
      detail: t('screenCaptureAccess.detail'),
      message: t('screenCaptureAccess.message'),
      noLink: true,
      title: t('screenCaptureAccess.title'),
      type: 'warning' as const,
    };

    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options);

    if (result.response !== 0) {
      logger.info(`Screen capture permission prompt dismissed; status=${status}`);
      return;
    }

    logger.info(`Opening screen capture permission settings; status=${status}`);
    if (await this.app.permissionGuide.open('screen')) return;
    await requestScreenCaptureAccess();
  }

  private async createOverlayWindow(bounds: Electron.Rectangle): Promise<void> {
    const win = new BrowserWindow({
      ...(isMac ? { type: 'panel' } : {}),
      enableLargerThanScreen: true,
      focusable: true,
      frame: false,
      fullscreenable: false,
      hasShadow: false,
      height: bounds.height,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        preload: `${preloadDir}/index.js`,
        sandbox: false,
      },
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, {
      ...(isMac ? { skipTransformProcessType: true } : {}),
      visibleOnFullScreen: true,
    });

    if (isMac) {
      win.setHiddenInMissionControl(true);
    }

    this.overlayWindow = win;

    win.webContents.on('did-fail-load', (_event, code, description) => {
      logger.error(`Overlay did-fail-load code=${code} description=${description}`);
    });

    const url = await this.app.buildRendererUrl('/overlay');
    logger.info(`Loading overlay URL: ${url}`);

    win.webContents.once('did-finish-load', () => {
      logger.info('Overlay did-finish-load');
      if (this.session && !win.isDestroyed()) {
        logger.info(`Sending overlay session with ${this.session.windows.length} windows`);
        win.webContents.send('screenCaptureSession', this.session);
      }
    });

    await win.loadURL(url);

    win.show();
    win.focus();
    win.moveTop();

    logger.info('Overlay window created and shown');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
