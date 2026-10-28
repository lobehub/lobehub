import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { ScreenCaptureWindowInfo } from '@lobechat/electron-client-ipc';
import * as screenCapture from '@lobechat/electron-mac-screen-capture';
import { app } from 'electron';
import { Window } from 'node-screenshots';

import { createLogger } from '@/utils/logger';

const logger = createLogger('screenCapture:WindowSourceService');

const MIN_WIDTH = 80;
const MIN_HEIGHT = 60;

const SYSTEM_APP_BLACKLIST = new Set([
  'Dock',
  'Window Server',
  'WindowServer',
  'Control Centre',
  'Control Center',
  'SystemUIServer',
  'Notification Centre',
  'Notification Center',
]);

interface DisplayBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface WindowWithOptionalScaleFactor {
  scaleFactor?: () => number;
}

async function openWindowsForCapture(): Promise<Array<{ owner: { processId: number } }>> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    // Keep the cross-platform JavaScript loader available during development
    // and for Windows/Linux builds, but do not load its Windows installation
    // dependency chain at startup in a packaged macOS application.
    const { openWindowsSync } = await import('get-windows');
    return openWindowsSync({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
  }

  // child_process does not redirect executable paths from app.asar to
  // app.asar.unpacked. Resolve the packaged macOS helper explicitly so only
  // that executable, rather than get-windows' optional install chain, ships.
  const binary = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'get-windows',
    'main',
  );
  const stdout = execFileSync(
    binary,
    ['--no-accessibility-permission', '--no-screen-recording-permission', '--open-windows-list'],
    { encoding: 'utf8' },
  );

  return JSON.parse(stdout) as Array<{ owner: { processId: number } }>;
}

function intersects(a: DisplayBounds, b: DisplayBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function normalizeWindowBounds(
  bounds: DisplayBounds,
  scaleFactor: number | undefined,
): DisplayBounds {
  if (process.platform !== 'win32') return bounds;

  const normalizedScaleFactor =
    typeof scaleFactor === 'number' && Number.isFinite(scaleFactor) && scaleFactor > 0
      ? scaleFactor
      : 1;

  if (normalizedScaleFactor === 1) return bounds;

  return {
    height: bounds.height / normalizedScaleFactor,
    width: bounds.width / normalizedScaleFactor,
    x: bounds.x / normalizedScaleFactor,
    y: bounds.y / normalizedScaleFactor,
  };
}

interface RawWindow {
  appName: string;
  bounds: DisplayBounds;
  title: string;
  windowId: number;
  z: number;
}

/**
 * Windows as ScreenCaptureKit reports them: frames in points, the same unit as
 * Electron's display bounds, frontmost first. The list already excludes
 * minimized and off-screen windows, so it needs neither the `get-windows`
 * whitelist nor a minimized check.
 */
function collectScreenCaptureKitWindows(): RawWindow[] | null {
  const content = screenCapture.screenShareableContent();
  if (!content) return null;

  return content.windows.map((window, index) => ({
    appName: window.appName,
    bounds: window.frame,
    title: window.title,
    // Frontmost first, so the z has to count down to keep the overlay's
    // stacking order.
    z: content.windows.length - index,
    windowId: window.windowID,
  }));
}

/** node-screenshots fallback: the collector behind macOS 13 and older. */
function collectNodeScreenshotsWindows(
  visiblePids: Set<number> | undefined,
  displayScaleFactor?: number,
): RawWindow[] {
  return Window.all()
    .filter((win) => !visiblePids || visiblePids.has(win.pid()))
    .filter((win) => !win.isMinimized())
    .map((win) => ({
      appName: win.appName(),
      bounds: normalizeWindowBounds(
        { height: win.height(), width: win.width(), x: win.x(), y: win.y() },
        displayScaleFactor ?? (win as WindowWithOptionalScaleFactor).scaleFactor?.(),
      ),
      title: win.title(),
      windowId: win.id(),
      z: win.z(),
    }));
}

function assembleWindows(
  candidates: RawWindow[],
  displayBounds: DisplayBounds,
  selfName: string,
): ScreenCaptureWindowInfo[] {
  const preparedWindows = candidates
    .filter((win) => !SYSTEM_APP_BLACKLIST.has(win.appName) && win.appName !== selfName)
    .filter((win) => win.bounds.width >= MIN_WIDTH && win.bounds.height >= MIN_HEIGHT)
    .filter((win) => intersects(win.bounds, displayBounds))
    .sort((left, right) => right.z - left.z);

  return preparedWindows.map((win, index) => ({
    appName: win.appName,
    bounds: win.bounds,
    order: index,
    overlayBounds: {
      height: win.bounds.height,
      width: win.bounds.width,
      x: win.bounds.x - displayBounds.x,
      y: win.bounds.y - displayBounds.y,
    },
    title: win.title,
    windowId: win.windowId,
  }));
}

export async function enumerateWindows(
  displayBounds: DisplayBounds,
  displayScaleFactor?: number,
): Promise<ScreenCaptureWindowInfo[]> {
  const selfName = app.getName();

  if (screenCapture.isSupported()) {
    const candidates = collectScreenCaptureKitWindows();
    if (candidates) {
      const results = assembleWindows(candidates, displayBounds, selfName);
      logger.info(`Enumerated ${results.length} windows for display via ScreenCaptureKit`);
      return results;
    }
    logger.warn('ScreenCaptureKit returned no shareable content, using node-screenshots');
  }

  let visiblePids: Set<number> | undefined;
  try {
    const visible = await openWindowsForCapture();
    visiblePids = new Set(visible.map((w) => w.owner.processId));
  } catch (error) {
    logger.warn('get-windows unavailable, skipping whitelist filter:', error);
  }

  const results = assembleWindows(
    collectNodeScreenshotsWindows(visiblePids, displayScaleFactor),
    displayBounds,
    selfName,
  );

  logger.info(`Enumerated ${results.length} windows for display`);
  return results;
}

/** node-screenshots fallback lookup, used by the matching capture path. */
export function findWindowById(windowId: number): Window | undefined {
  return Window.all().find((w) => w.id() === windowId);
}
