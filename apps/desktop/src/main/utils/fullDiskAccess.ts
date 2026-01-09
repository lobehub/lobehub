/**
 * Full Disk Access utilities for macOS
 * Based on https://github.com/inket/FullDiskAccess
 */
import { shell } from 'electron';
import { macOS } from 'electron-is';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from './logger';

const logger = createLogger('utils:fullDiskAccess');

/**
 * Get the macOS major version number
 * Returns 0 if not macOS or unable to determine
 *
 * Darwin version to macOS version mapping:
 * - Darwin 23.x = macOS 14 (Sonoma)
 * - Darwin 22.x = macOS 13 (Ventura)
 * - Darwin 21.x = macOS 12 (Monterey)
 * - Darwin 20.x = macOS 11 (Big Sur)
 * - Darwin 19.x = macOS 10.15 (Catalina)
 * - Darwin 18.x = macOS 10.14 (Mojave)
 */
export function getMacOSMajorVersion(): number {
  if (!macOS()) return 0;
  try {
    const release = os.release(); // e.g., "23.0.0" for macOS 14 (Sonoma)
    const darwinMajor = Number.parseInt(release.split('.')[0], 10);
    if (darwinMajor >= 20) {
      return darwinMajor - 9; // Darwin 20 = macOS 11, Darwin 21 = macOS 12, etc.
    }
    // For older versions, return 10 (covers Mojave and Catalina)
    return 10;
  } catch {
    return 0;
  }
}

/**
 * Check if Full Disk Access is granted by attempting to read a protected directory.
 *
 * On macOS 12+ (Monterey, Ventura, Sonoma, Sequoia): checks ~/Library/Containers/com.apple.stocks
 * On macOS 10.14-11 (Mojave, Catalina, Big Sur): checks ~/Library/Safari
 *
 * Reading these directories will also register the app in TCC database,
 * making it appear in System Settings > Privacy & Security > Full Disk Access
 */
export function checkFullDiskAccess(): boolean {
  if (!macOS()) return true;

  const homeDir = os.homedir();
  const macOSVersion = getMacOSMajorVersion();

  // Determine which protected directory to check based on macOS version
  let checkPath: string;
  if (macOSVersion >= 12) {
    // macOS 12+ (Monterey, Ventura, Sonoma, Sequoia)
    checkPath = path.join(homeDir, 'Library', 'Containers', 'com.apple.stocks');
  } else {
    // macOS 10.14-11 (Mojave, Catalina, Big Sur)
    checkPath = path.join(homeDir, 'Library', 'Safari');
  }

  try {
    fs.readdirSync(checkPath);
    logger.info(`[FullDiskAccess] Access granted (able to read ${checkPath})`);
    return true;
  } catch {
    logger.info(`[FullDiskAccess] Access not granted (unable to read ${checkPath})`);
    return false;
  }
}

/**
 * Open Full Disk Access settings page in System Settings
 *
 * NOTE: Full Disk Access cannot be requested programmatically.
 * User must manually add the app in System Settings.
 * There is NO entitlement for Full Disk Access - it's purely TCC controlled.
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  if (!macOS()) {
    logger.info('[FullDiskAccess] Not macOS, skipping');
    return;
  }

  logger.info('[FullDiskAccess] Opening Full Disk Access settings...');

  // On macOS 13+ (Ventura), System Preferences is replaced by System Settings,
  // and deep links may differ. We try multiple known schemes for compatibility.
  const candidates = [
    // macOS 13+ (Ventura and later) - System Settings
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    // macOS 13+ alternative format
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  ];

  for (const url of candidates) {
    try {
      logger.info(`[FullDiskAccess] Trying URL: ${url}`);
      await shell.openExternal(url);
      logger.info(`[FullDiskAccess] Successfully opened via ${url}`);
      return;
    } catch (error) {
      logger.warn(`[FullDiskAccess] Failed with URL ${url}:`, error);
    }
  }

  // Fallback: open Privacy & Security pane
  try {
    const fallbackUrl = 'x-apple.systempreferences:com.apple.preference.security?Privacy';
    logger.info(`[FullDiskAccess] Trying fallback URL: ${fallbackUrl}`);
    await shell.openExternal(fallbackUrl);
    logger.info('[FullDiskAccess] Opened Privacy & Security settings as fallback');
  } catch (error) {
    logger.error('[FullDiskAccess] Failed to open any Privacy settings:', error);
  }
}
