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

  constructor(private readonly app: App) {}

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

  async startSession(): Promise<void> {
    if (!(await this.ensureScreenCaptureAccess())) {
      return;
    }

    if (this.isActive) {
      logger.warn('Capture session already active');
      this.close();
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { bounds, scaleFactor } = display;

    logger.info(
      `Starting capture session on display ${display.id} (${bounds.width}x${bounds.height} @${scaleFactor}x)`,
    );

    const windows = await enumerateWindows(bounds, scaleFactor);

    this.session = {
      displayBounds: bounds,
      scaleFactor,
      windows,
      ...this.snapshot,
    };

    await this.createOverlayWindow(bounds);
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
    const pngBuffer = await this.withOverlayHidden(() => captureWindow(windowId));
    if (!pngBuffer) {
      return { error: 'capture failed', success: false };
    }

    const captureId = randomUUID();
    const filename = `screen-capture-${captureId}.png`;
    this.dispatchUpload(captureId, filename, pngBuffer);

    return {
      captureId,
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
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
    const pngBuffer = await this.withOverlayHidden(() =>
      captureRect(absolute, scaleFactor, displayBounds),
    );
    if (!pngBuffer) {
      return { error: 'capture failed', success: false };
    }

    const captureId = randomUUID();
    const filename = `screen-capture-${captureId}.png`;
    this.dispatchUpload(captureId, filename, pngBuffer);

    return {
      captureId,
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      rect: params,
      success: true,
    };
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

  private async ensureScreenCaptureAccess(): Promise<boolean> {
    if (!isMac) {
      return true;
    }

    const status = getScreenCaptureStatus();
    if (status === 'granted') {
      return true;
    }

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
      return false;
    }

    logger.info(`Opening screen capture permission settings; status=${status}`);
    await requestScreenCaptureAccess();

    return false;
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
