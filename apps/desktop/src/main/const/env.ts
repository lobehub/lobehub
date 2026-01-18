import { dev, linux, macOS, windows } from 'electron-is';
import os from 'node:os';

import { getDesktopEnv } from '@/env';

export const isDev = dev();

export const OFFICIAL_CLOUD_SERVER = getDesktopEnv().OFFICIAL_CLOUD_SERVER;

export const isMac = macOS();
export const isWindows = windows();
export const isLinux = linux();

function getIsWindows11() {
  if (!isWindows) return false;
  // Get OS version (e.g., "10.0.22621")
  const release = os.release();
  const parts = release.split('.');

  // Major and minor version
  const majorVersion = parseInt(parts[0], 10);
  const minorVersion = parseInt(parts[1], 10);

  // Build number is the third part
  const buildNumber = parseInt(parts[2], 10);

  // Windows 11 build numbers start from 22000
  return majorVersion === 10 && minorVersion === 0 && buildNumber >= 22_000;
}

export const isWindows11 = getIsWindows11();
