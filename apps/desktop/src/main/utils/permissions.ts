/**
 * Unified macOS Permission Management using node-mac-permissions
 * @see https://github.com/codebytere/node-mac-permissions
 */
import { shell } from 'electron';
import { macOS } from 'electron-is';
import {
  askForAccessibilityAccess,
  askForCameraAccess,
  askForFullDiskAccess,
  askForMicrophoneAccess,
  askForScreenCaptureAccess,
  getAuthStatus,
  type AuthType,
  type PermissionType,
} from 'node-mac-permissions';

import { createLogger } from './logger';

const logger = createLogger('utils:permissions');

/**
 * Permission status mapping between node-mac-permissions and our internal representation
 */
export type PermissionStatus =
  | 'authorized'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'granted'; // alias for authorized

/**
 * Normalize permission status to a consistent format
 */
function normalizeStatus(status: PermissionType | 'not determined'): PermissionStatus {
  if (status === 'not determined') return 'not-determined';
  if (status === 'authorized') return 'granted';
  return status;
}

/**
 * Get the authorization status for a specific permission type
 */
export function getPermissionStatus(type: AuthType): PermissionStatus {
  if (!macOS()) {
    logger.debug(`[Permission] Not macOS, returning granted for ${type}`);
    return 'granted';
  }

  const status = getAuthStatus(type);
  const normalized = normalizeStatus(status);
  logger.info(`[Permission] ${type} status: ${normalized}`);
  return normalized;
}

/**
 * Check if Accessibility permission is granted
 */
export function getAccessibilityStatus(): PermissionStatus {
  return getPermissionStatus('accessibility');
}

/**
 * Request Accessibility permission
 * Opens System Preferences to the Accessibility pane
 */
export function requestAccessibilityAccess(): boolean {
  if (!macOS()) {
    logger.info('[Accessibility] Not macOS, returning true');
    return true;
  }

  logger.info('[Accessibility] Requesting accessibility access...');
  askForAccessibilityAccess();

  // Check the status after requesting
  const status = getPermissionStatus('accessibility');
  return status === 'granted';
}

/**
 * Check if Microphone permission is granted
 */
export function getMicrophoneStatus(): PermissionStatus {
  return getPermissionStatus('microphone');
}

/**
 * Request Microphone permission
 * Shows the system permission dialog if not determined
 */
export async function requestMicrophoneAccess(): Promise<boolean> {
  if (!macOS()) {
    logger.info('[Microphone] Not macOS, returning true');
    return true;
  }

  const currentStatus = getPermissionStatus('microphone');
  logger.info(`[Microphone] Current status: ${currentStatus}`);

  if (currentStatus === 'granted') {
    logger.info('[Microphone] Already granted');
    return true;
  }

  if (currentStatus === 'not-determined') {
    logger.info('[Microphone] Status is not-determined, requesting access...');
    try {
      const result = await askForMicrophoneAccess();
      logger.info(`[Microphone] askForMicrophoneAccess result: ${result}`);
      return result === 'authorized';
    } catch (error) {
      logger.error('[Microphone] askForMicrophoneAccess failed:', error);
      return false;
    }
  }

  // If denied or restricted, open System Settings for manual enable
  logger.info(`[Microphone] Status is ${currentStatus}, opening System Settings...`);
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  );
  return false;
}

/**
 * Check if Camera permission is granted
 */
export function getCameraStatus(): PermissionStatus {
  return getPermissionStatus('camera');
}

/**
 * Request Camera permission
 * Shows the system permission dialog if not determined
 */
export async function requestCameraAccess(): Promise<boolean> {
  if (!macOS()) {
    logger.info('[Camera] Not macOS, returning true');
    return true;
  }

  const currentStatus = getPermissionStatus('camera');
  logger.info(`[Camera] Current status: ${currentStatus}`);

  if (currentStatus === 'granted') {
    logger.info('[Camera] Already granted');
    return true;
  }

  if (currentStatus === 'not-determined') {
    logger.info('[Camera] Status is not-determined, requesting access...');
    try {
      const result = await askForCameraAccess();
      logger.info(`[Camera] askForCameraAccess result: ${result}`);
      return result === 'authorized';
    } catch (error) {
      logger.error('[Camera] askForCameraAccess failed:', error);
      return false;
    }
  }

  // If denied or restricted, open System Settings for manual enable
  logger.info(`[Camera] Status is ${currentStatus}, opening System Settings...`);
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  );
  return false;
}

/**
 * Check if Screen Recording permission is granted
 */
export function getScreenCaptureStatus(): PermissionStatus {
  return getPermissionStatus('screen');
}

/**
 * Request Screen Recording permission
 * Opens System Preferences if access not granted
 * @param openPreferences - Whether to open System Preferences (default: true)
 */
export async function requestScreenCaptureAccess(openPreferences = true): Promise<boolean> {
  if (!macOS()) {
    logger.info('[Screen] Not macOS, returning true');
    return true;
  }

  const currentStatus = getPermissionStatus('screen');
  logger.info(`[Screen] Current status: ${currentStatus}`);

  if (currentStatus === 'granted') {
    logger.info('[Screen] Already granted');
    return true;
  }

  // Request screen capture access - this will prompt the user or open settings
  logger.info('[Screen] Requesting screen capture access...');
  askForScreenCaptureAccess(openPreferences);

  // Check the status after requesting
  const newStatus = getPermissionStatus('screen');
  logger.info(`[Screen] Status after request: ${newStatus}`);
  return newStatus === 'granted';
}

/**
 * Check if Full Disk Access permission is granted
 */
export function getFullDiskAccessStatus(): PermissionStatus {
  return getPermissionStatus('full-disk-access');
}

/**
 * Request Full Disk Access permission
 * Opens System Preferences to the Full Disk Access pane
 * Note: Full Disk Access cannot be granted programmatically,
 * user must manually add the app in System Settings
 */
export function requestFullDiskAccess(): void {
  if (!macOS()) {
    logger.info('[FullDiskAccess] Not macOS, skipping');
    return;
  }

  logger.info('[FullDiskAccess] Opening Full Disk Access settings...');
  askForFullDiskAccess();
}

/**
 * Open Full Disk Access settings page in System Settings
 * Alternative method using shell.openExternal
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  if (!macOS()) {
    logger.info('[FullDiskAccess] Not macOS, skipping');
    return;
  }

  logger.info('[FullDiskAccess] Opening Full Disk Access settings via shell...');

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

/**
 * Check if Input Monitoring permission is granted
 */
export function getInputMonitoringStatus(): PermissionStatus {
  return getPermissionStatus('input-monitoring');
}

/**
 * Get media access status (compatibility wrapper for Electron API)
 * Maps 'microphone' and 'screen' to corresponding permission checks
 */
export function getMediaAccessStatus(mediaType: 'microphone' | 'screen'): string {
  if (!macOS()) return 'granted';

  const status = getPermissionStatus(mediaType === 'microphone' ? 'microphone' : 'screen');

  // Map our status back to Electron's expected format
  switch (status) {
    case 'granted': {
      return 'granted';
    }
    case 'not-determined': {
      return 'not-determined';
    }
    case 'denied': {
      return 'denied';
    }
    case 'restricted': {
      return 'restricted';
    }
    default: {
      return 'unknown';
    }
  }
}
