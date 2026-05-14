import type { DetectedApp } from '@lobechat/electron-client-ipc';

import { detectAllApps } from './detectors';

let cachedPromise: Promise<DetectedApp[]> | null = null;

export const getCachedDetection = (
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedApp[]> => {
  if (!cachedPromise) {
    cachedPromise = detectAllApps(platform);
  }
  return cachedPromise;
};

export const clearDetectionCache = (): void => {
  cachedPromise = null;
};
