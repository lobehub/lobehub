import type { CaptureRectParams } from '@lobechat/electron-client-ipc';
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

/**
 * Capture a specific window by its native window id.
 */
export async function captureWindow(windowId: number): Promise<Buffer | null> {
  try {
    const win = findWindowById(windowId);
    if (!win) {
      logger.warn(`Window ${windowId} not found`);
      return null;
    }
    const image = await win.captureImage();
    const pngBuffer = Buffer.from(await image.toPng());
    return pngBuffer;
  } catch (error) {
    logger.error('Failed to capture window:', error);
    return null;
  }
}

/**
 * Capture a rect region from the monitor that contains the rect.
 * `absoluteRect` is in absolute DIP coordinates.
 */
export async function captureRect(
  absoluteRect: CaptureRectParams,
  scaleFactor: number,
  displayBounds?: DisplayBounds,
): Promise<Buffer | null> {
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
      return null;
    }

    const image = await captureMonitorImageWithRetry(monitor);
    if (!image) {
      return null;
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
      return null;
    }

    const cropped = await image.crop(cropX, cropY, cropW, cropH);
    const pngBuffer = Buffer.from(await cropped.toPng());
    return pngBuffer;
  } catch (error) {
    logger.error('Failed to capture rect:', error);
    return null;
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
