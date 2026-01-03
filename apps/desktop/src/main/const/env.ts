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
  // 获取操作系统版本（如 "10.0.22621"）
  const release = os.release();
  const parts = release.split('.');

  // 主版本和次版本
  const majorVersion = parseInt(parts[0], 10);
  const minorVersion = parseInt(parts[1], 10);

  // 构建号是第三部分
  const buildNumber = parseInt(parts[2], 10);

  // Windows 11 的构建号从 22000 开始
  return majorVersion === 10 && minorVersion === 0 && buildNumber >= 22_000;
}

export const isWindows11 = getIsWindows11();
