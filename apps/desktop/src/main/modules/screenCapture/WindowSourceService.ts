import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { ScreenCaptureWindowInfo } from '@lobechat/electron-client-ipc';
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

interface PreparedWindow {
  appName: string;
  bounds: DisplayBounds;
  title: string;
  windowId: number;
  z: number;
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

export async function enumerateWindows(
  displayBounds: DisplayBounds,
  displayScaleFactor?: number,
): Promise<ScreenCaptureWindowInfo[]> {
  const selfName = app.getName();

  let visiblePids: Set<number> | undefined;
  try {
    const visible = await openWindowsForCapture();
    visiblePids = new Set(visible.map((w) => w.owner.processId));
  } catch (error) {
    logger.warn('get-windows unavailable, skipping whitelist filter:', error);
  }

  const preparedWindows = Window.all()
    .map((win): PreparedWindow | null => {
      if (visiblePids && !visiblePids.has(win.pid())) return null;

      const appName = win.appName();
      if (SYSTEM_APP_BLACKLIST.has(appName) || appName === selfName) return null;
      if (win.isMinimized()) return null;

      const width = win.width();
      const height = win.height();
      if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;

      const bounds = {
        height,
        width,
        x: win.x(),
        y: win.y(),
      };
      const normalizedBounds = normalizeWindowBounds(
        bounds,
        displayScaleFactor ?? (win as WindowWithOptionalScaleFactor).scaleFactor?.(),
      );
      if (!intersects(normalizedBounds, displayBounds)) return null;

      return {
        appName,
        bounds: normalizedBounds,
        title: win.title(),
        windowId: win.id(),
        z: win.z(),
      };
    })
    .filter((win): win is PreparedWindow => win !== null)
    .sort((left, right) => right.z - left.z);

  const results = preparedWindows.map((win, index) => ({
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

  logger.info(`Enumerated ${results.length} windows for display`);
  return results;
}

export function findWindowById(windowId: number): Window | undefined {
  return Window.all().find((w) => w.id() === windowId);
}
