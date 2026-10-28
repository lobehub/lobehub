import type { CaptureRectParams } from '@lobechat/electron-client-ipc';
import type { CaptureFailure } from '@lobechat/electron-mac-screen-capture';
import * as screenCapture from '@lobechat/electron-mac-screen-capture';
import { Monitor } from 'node-screenshots';

import { createLogger } from '@/utils/logger';

import { findWindowById } from './WindowSourceService';

const logger = createLogger('screenCapture:CaptureService');
const CAPTURE_RETRY_DELAY_MS = 120;
const CAPTURE_RETRY_TIMES = 2;

interface DisplayBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CaptureResult {
  png: Buffer | null;
  /** Why there is no image; `null` on success. */
  reason: CaptureFailure | null;
}

const failure = (reason: CaptureFailure): CaptureResult => ({ png: null, reason });
const success = (png: Buffer): CaptureResult => ({ png, reason: null });

/**
 * Capture a specific window by its native window id.
 *
 * ScreenCaptureKit serves every macOS that has `SCScreenshotManager` (14+): it
 * is the API Apple points at now that `CGWindowListCreateImage` is obsoleted
 * (macOS 15), it captures at native pixel resolution, and it re-reads the Screen
 * Recording grant on every call instead of needing a fresh process. The
 * node-screenshots implementation below stays for macOS 13 and older, where the
 * deprecated API raises no alert yet.
 *
 * There is deliberately no fallback when ScreenCaptureKit fails: the legacy API
 * answers an unauthorised capture with a blank image instead of an error, and a
 * black screenshot reads as a successful one.
 */
export async function captureWindow(windowId: number): Promise<CaptureResult> {
  if (screenCapture.isSupported()) {
    return screenCapture.captureWindow(windowId);
  }

  return captureWindowLegacy(windowId);
}

/** node-screenshots fallback for macOS 13 and older. */
async function captureWindowLegacy(windowId: number): Promise<CaptureResult> {
  try {
    const win = findWindowById(windowId);
    if (!win) {
      logger.warn(`Window ${windowId} not found`);
      return failure('not-found');
    }
    const image = await win.captureImage();
    return success(Buffer.from(await image.toPng()));
  } catch (error) {
    logger.error('Failed to capture window:', error);
    return failure('failed');
  }
}

/**
 * Capture a rect region from the monitor that contains the rect.
 * `absoluteRect` is in absolute DIP coordinates.
 *
 * ScreenCaptureKit crops inside the capture itself and picks the display from
 * that rect, so the monitor lookup and manual crop below only serve the macOS 13
 * fallback.
 */
export async function captureRect(
  absoluteRect: CaptureRectParams,
  scaleFactor: number,
  displayBounds?: DisplayBounds,
): Promise<CaptureResult> {
  if (screenCapture.isSupported()) {
    return screenCapture.captureRect(absoluteRect);
  }

  return captureRectLegacy(absoluteRect, scaleFactor, displayBounds);
}

/** node-screenshots fallback: capture the whole monitor, then crop in memory. */
async function captureRectLegacy(
  absoluteRect: CaptureRectParams,
  scaleFactor: number,
  displayBounds?: DisplayBounds,
): Promise<CaptureResult> {
  try {
    const centerX = Math.round((absoluteRect.x + absoluteRect.width / 2) * scaleFactor);
    const centerY = Math.round((absoluteRect.y + absoluteRect.height / 2) * scaleFactor);
    const monitor = resolveMonitor({
      centerX,
      centerY,
      displayBounds,
      scaleFactor,
    });

    if (!monitor) {
      logger.warn(`No monitor found at point (${centerX}, ${centerY})`);
      return failure('not-found');
    }

    const image = await captureMonitorImageWithRetry(monitor);
    if (!image) {
      return failure('failed');
    }

    const physX = Math.round(absoluteRect.x * scaleFactor) - monitor.x();
    const physY = Math.round(absoluteRect.y * scaleFactor) - monitor.y();
    const physW = Math.round(absoluteRect.width * scaleFactor);
    const physH = Math.round(absoluteRect.height * scaleFactor);

    const cropX = Math.max(0, physX);
    const cropY = Math.max(0, physY);
    const cropW = Math.min(physW, image.width - cropX);
    const cropH = Math.min(physH, image.height - cropY);

    if (cropW <= 0 || cropH <= 0) {
      logger.warn(`Crop rect out of monitor bounds: ${cropX},${cropY} ${cropW}x${cropH}`);
      return failure('not-found');
    }

    const cropped = await image.crop(cropX, cropY, cropW, cropH);
    return success(Buffer.from(await cropped.toPng()));
  } catch (error) {
    logger.error('Failed to capture rect:', error);
    return failure('failed');
  }
}

async function captureMonitorImageWithRetry(
  monitor: Monitor,
): Promise<Awaited<ReturnType<Monitor['captureImage']>> | null> {
  for (let attempt = 1; attempt <= CAPTURE_RETRY_TIMES; attempt += 1) {
    try {
      const image = await monitor.captureImage();
      return image;
    } catch (error) {
      logger.error(`captureImage failed on attempt ${attempt} for monitor ${monitor.id()}:`, error);

      if (attempt < CAPTURE_RETRY_TIMES) {
        await delay(CAPTURE_RETRY_DELAY_MS);
        continue;
      }
    }
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveMonitor({
  centerX,
  centerY,
  displayBounds,
  scaleFactor,
}: {
  centerX: number;
  centerY: number;
  displayBounds?: DisplayBounds;
  scaleFactor: number;
}): Monitor | null {
  const monitors = Monitor.all();
  const displayMonitor = displayBounds
    ? findMonitorByDisplayBounds(monitors, displayBounds, scaleFactor)
    : null;

  if (displayMonitor) {
    return displayMonitor;
  }

  return Monitor.fromPoint(centerX, centerY);
}

function findMonitorByDisplayBounds(
  monitors: Monitor[],
  displayBounds: DisplayBounds,
  scaleFactor: number,
): Monitor | null {
  const expected = {
    height: Math.round(displayBounds.height * scaleFactor),
    width: Math.round(displayBounds.width * scaleFactor),
    x: Math.round(displayBounds.x * scaleFactor),
    y: Math.round(displayBounds.y * scaleFactor),
  };

  let bestMonitor: Monitor | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const monitor of monitors) {
    const score =
      Math.abs(monitor.x() - expected.x) +
      Math.abs(monitor.y() - expected.y) +
      Math.abs(monitor.width() - expected.width) +
      Math.abs(monitor.height() - expected.height);

    if (score < bestScore) {
      bestMonitor = monitor;
      bestScore = score;
    }
  }

  return bestMonitor;
}
