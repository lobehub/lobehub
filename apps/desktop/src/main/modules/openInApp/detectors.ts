import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { DetectedApp, OpenInAppId } from '@lobechat/electron-client-ipc';

import { createLogger } from '@/utils/logger';

import { extractAllIcons } from './iconExtractor';
import type { DetectStrategy } from './registry';
import { ALWAYS_INSTALLED, APP_REGISTRY } from './registry';

// Icon extraction shells out to plutil + sips on macOS (see iconExtractor.ts)
// so Electron itself cannot crash on `app.getFileIcon` regressions. Renderer
// falls back to lucide if extraction returns undefined.

const logger = createLogger('modules:openInApp:detectors');

const execFileAsync = promisify(execFile);

const SAFE_BINARY_REGEX = /^[\w.-]+$/;

const probeAppBundle = async (paths: string[]): Promise<boolean> => {
  for (const path of paths) {
    try {
      await access(path);
      return true;
    } catch {
      // try next
    }
  }
  return false;
};

const probeCommandV = async (binary: string): Promise<boolean> => {
  if (!SAFE_BINARY_REGEX.test(binary)) {
    logger.debug(`rejecting unsafe binary name for commandV: ${binary}`);
    return false;
  }
  try {
    await execFileAsync('/bin/sh', ['-c', `command -v "${binary}"`]);
    return true;
  } catch (error) {
    logger.debug(`commandV probe failed for ${binary}: ${(error as Error).message}`);
    return false;
  }
};

const probeRegistryAppPaths = async (exeName: string): Promise<boolean> => {
  try {
    await execFileAsync('where', [exeName], { windowsHide: true });
    return true;
  } catch (error) {
    logger.debug(`where probe failed for ${exeName}: ${(error as Error).message}`);
    return false;
  }
};

const runDetectStrategy = (strategy: DetectStrategy): Promise<boolean> => {
  switch (strategy.type) {
    case 'appBundle': {
      return probeAppBundle(strategy.paths);
    }
    case 'commandV': {
      return probeCommandV(strategy.binary);
    }
    case 'registryAppPaths': {
      return probeRegistryAppPaths(strategy.exeName);
    }
  }
};

export const detectApp = async (id: OpenInAppId, platform: NodeJS.Platform): Promise<boolean> => {
  if (ALWAYS_INSTALLED[platform] === id) {
    return true;
  }
  const descriptor = APP_REGISTRY[id];
  const strategy = descriptor?.detect[platform];
  if (!strategy) {
    return false;
  }
  return runDetectStrategy(strategy);
};

export const detectAllApps = async (
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedApp[]> => {
  const entries = Object.entries(APP_REGISTRY) as Array<
    [OpenInAppId, (typeof APP_REGISTRY)[OpenInAppId]]
  >;
  const installedFlags = await Promise.all(entries.map(([id]) => detectApp(id, platform)));

  // Extract icons for installed apps only. Extraction shells out to plutil +
  // sips (see iconExtractor.ts) so it cannot crash the renderer; failures
  // resolve to undefined and the renderer falls back to lucide icons.
  const installedIds = entries.filter((_entry, i) => installedFlags[i]).map(([id]) => id);
  const icons = await extractAllIcons(installedIds, platform);

  return entries.map(([id, descriptor], i) => {
    const installed = installedFlags[i];
    const icon = installed ? icons.get(id) : undefined;
    return {
      displayName: descriptor.displayName,
      id,
      installed,
      ...(icon ? { icon } : {}),
    } satisfies DetectedApp;
  });
};
