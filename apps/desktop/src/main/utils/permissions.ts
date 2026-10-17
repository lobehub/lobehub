/**
 * Unified macOS Permission Management using node-mac-permissions
 * @see https://github.com/codebytere/node-mac-permissions
 *
 * IMPORTANT: node-mac-permissions is a macOS-only native module.
 * It must be dynamically imported to prevent loading errors on Windows/Linux.
 */
import type * as GuideAddonModule from '@lobechat/electron-mac-permission-guide';
import type * as ScreenCaptureAddonModule from '@lobechat/electron-mac-screen-capture';
import { shell } from 'electron';
import type * as MacPermissions from 'node-mac-permissions';

import { createLogger } from './logger';
import * as electronIs from './platform';

// Type definitions - use module types when available, fallback to local definition
// Note: We don't import the module statically, so we need local type definitions
type AuthType =
  | 'accessibility'
  | 'calendar'
  | 'camera'
  | 'contacts'
  | 'full-disk-access'
  | 'input-monitoring'
  | 'location'
  | 'microphone'
  | 'reminders'
  | 'screen'
  | 'speech-recognition';

type PermissionType = 'authorized' | 'denied' | 'not determined' | 'restricted';

type MacPermissionsModule = typeof MacPermissions;

// Lazy-loaded module cache
let macPermissionsModule: MacPermissionsModule | null = null;

// Test injection override (set via __setMacPermissionsModule for testing)
let testModuleOverride: MacPermissionsModule | null = null;

/**
 * Lazily load the node-mac-permissions module (macOS only)
 * Returns null on non-macOS platforms
 */
function getMacPermissionsModule(): MacPermissionsModule | null {
  // Allow test injection to override the module
  if (testModuleOverride) {
    return testModuleOverride;
  }

  if (!electronIs.macOS()) {
    return null;
  }

  if (!macPermissionsModule) {
    // Dynamic require to prevent module loading on non-macOS platforms
    macPermissionsModule = require('node-mac-permissions') as MacPermissionsModule;
  }

  return macPermissionsModule;
}

/**
 * Reset the module cache (for testing purposes)
 * @internal
 */
export function __resetMacPermissionsModuleCache(): void {
  macPermissionsModule = null;
  testModuleOverride = null;
}

/**
 * Set the mac permissions module (for testing purposes)
 * @internal
 */
export function __setMacPermissionsModule(module: MacPermissionsModule | null): void {
  testModuleOverride = module;
}

const logger = createLogger('utils:permissions');

type GuideAddon = typeof GuideAddonModule;
type ScreenCaptureAddon = typeof ScreenCaptureAddonModule;

// The native guide addon answers Screen Recording queries live; see
// `getScreenCaptureStatus`. Lazy and guarded like node-mac-permissions so a
// missing or non-darwin build degrades instead of breaking the import graph.
let guideAddonModule: GuideAddon | null = null;

// Test injection override (set via __setGuideAddonModule for testing)
let guideAddonOverride: GuideAddon | null = null;

// The ScreenCaptureKit addon answers the same question from the capture side;
// `isScreenCaptureUsable` prefers it wherever it exists.
let screenCaptureAddonModule: ScreenCaptureAddon | null = null;

// Test injection override (set via __setScreenCaptureModule for testing)
let screenCaptureOverride: ScreenCaptureAddon | null = null;

function requireAddon<T>(name: string, label: string): T | null {
  try {
    return require(name) as T;
  } catch (error) {
    logger.warn(`[Permission] ${label} native module unavailable:`, error);
    return null;
  }
}

function getGuideAddon(): GuideAddon | null {
  if (guideAddonOverride) {
    return guideAddonOverride;
  }

  if (!electronIs.macOS()) {
    return null;
  }

  if (!guideAddonModule) {
    guideAddonModule = requireAddon<GuideAddon>(
      '@lobechat/electron-mac-permission-guide',
      'permission guide',
    );
  }

  return guideAddonModule;
}

function getScreenCaptureAddon(): ScreenCaptureAddon | null {
  if (screenCaptureOverride) {
    return screenCaptureOverride;
  }

  if (!electronIs.macOS()) {
    return null;
  }

  if (!screenCaptureAddonModule) {
    screenCaptureAddonModule = requireAddon<ScreenCaptureAddon>(
      '@lobechat/electron-mac-screen-capture',
      'screen capture',
    );
  }

  return screenCaptureAddonModule;
}

/**
 * Set the guide addon (for testing purposes)
 * @internal
 */
export function __setGuideAddonModule(module: GuideAddon | null): void {
  guideAddonOverride = module;
  guideAddonModule = null;
}

/**
 * Set the ScreenCaptureKit addon (for testing purposes)
 * @internal
 */
export function __setScreenCaptureModule(module: ScreenCaptureAddon | null): void {
  screenCaptureOverride = module;
  screenCaptureAddonModule = null;
}

/**
 * Permission status mapping between node-mac-permissions and our internal representation
 */
export type PermissionStatus =
  'authorized' | 'denied' | 'not-determined' | 'restricted' | 'granted'; // alias for authorized

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
  const macPermissions = getMacPermissionsModule();
  if (!macPermissions) {
    logger.debug(`[Permission] Not macOS, returning granted for ${type}`);
    return 'granted';
  }

  const status = macPermissions.getAuthStatus(type);
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
  const macPermissions = getMacPermissionsModule();
  if (!macPermissions) {
    logger.info('[Accessibility] Not macOS, returning true');
    return true;
  }

  logger.info('[Accessibility] Requesting accessibility access...');
  macPermissions.askForAccessibilityAccess();

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
  const macPermissions = getMacPermissionsModule();
  if (!macPermissions) {
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
      const result = await macPermissions.askForMicrophoneAccess();
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
  const macPermissions = getMacPermissionsModule();
  if (!macPermissions) {
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
      const result = await macPermissions.askForCameraAccess();
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
 * Screen Recording authorization as the native guide addon reports it, which
 * asks tccd directly. Returns `null` when the addon is unavailable so callers
 * can fall back to node-mac-permissions.
 */
function readLiveScreenCaptureStatus(): PermissionStatus | null {
  const addon = getGuideAddon();
  if (!addon) return null;

  try {
    const status = addon.screenCaptureStatus();
    if (status === 'granted' || status === 'denied') return status;
    if (status === 'unknown') return 'not-determined';
    return null;
  } catch (error) {
    logger.warn('[Screen] Native status query failed:', error);
    return null;
  }
}

/**
 * Check if Screen Recording permission is granted.
 *
 * `CGPreflightScreenCaptureAccess` caches whatever it first returned for the
 * rest of the process lifetime, so an app that asked before the user flipped
 * the switch keeps reading "denied" and had to be relaunched to notice. The
 * native query re-reads the decision on every call, which is what lets the
 * onboarding row and the permission guide follow the switch live.
 */
export function getScreenCaptureStatus(): PermissionStatus {
  const live = readLiveScreenCaptureStatus();
  if (live !== null) return live;
  return getPermissionStatus('screen');
}

/**
 * Whether this process can actually capture the screen right now.
 *
 * ScreenCaptureKit answers that directly and it is the API the capture path
 * uses on macOS 14 and newer, so its verdict is the truth there. Below 14 the
 * capture path is CoreGraphics, where a readable foreign window title is the
 * live signal instead. Neither source caches an answer the way the public
 * `CGPreflightScreenCaptureAccess` does.
 *
 * Defaults to `true` when no probe exists — the guide that consults this never
 * runs without the native addons, and a missing probe must not send the user
 * through a relaunch.
 */
export function isScreenCaptureUsable(): boolean {
  // ScreenCaptureKit raises the system prompt while the permission is
  // unresolved, so the prompt-free status read stays the gate in front of it.
  if (getScreenCaptureStatus() !== 'granted') return false;

  const capture = getScreenCaptureAddon();
  if (capture?.isSupported()) {
    try {
      return capture.probeCapturePermission() === 'granted';
    } catch (error) {
      logger.warn('[Screen] ScreenCaptureKit probe failed:', error);
    }
  }

  const guide = getGuideAddon();
  if (!guide) return true;

  try {
    return guide.canReadOtherAppWindowTitles() ?? true;
  } catch (error) {
    logger.warn('[Screen] Native usability probe failed:', error);
    return true;
  }
}

/**
 * Request Screen Recording permission
 *
 * Deliberately does not call `CGRequestScreenCaptureAccess`: that alert is what
 * makes macOS tell the user the app has to be quit and reopened, and Screen
 * Recording cannot be granted from the alert anyway — the user has to add the
 * app to the list by hand. Opening the pane hands off to the drag guide, and
 * the live status query reports the grant afterwards.
 *
 * @param openPreferences - Whether to open System Settings (default: true)
 */
export async function requestScreenCaptureAccess(openPreferences = true): Promise<boolean> {
  if (!electronIs.macOS()) {
    logger.info('[Screen] Not macOS, returning true');
    return true;
  }

  const currentStatus = getScreenCaptureStatus();
  logger.info(`[Screen] Current status: ${currentStatus}`);

  if (currentStatus === 'granted') {
    logger.info('[Screen] Already granted');
    return true;
  }

  if (openPreferences) {
    logger.info('[Screen] Opening Screen Recording settings...');
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }

  return getScreenCaptureStatus() === 'granted';
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
  const macPermissions = getMacPermissionsModule();
  if (!macPermissions) {
    logger.info('[FullDiskAccess] Not macOS, skipping');
    return;
  }

  logger.info('[FullDiskAccess] Opening Full Disk Access settings...');
  macPermissions.askForFullDiskAccess();
}

/**
 * Open Full Disk Access settings page in System Settings
 * Alternative method using shell.openExternal
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  if (!electronIs.macOS()) {
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
  if (!electronIs.macOS()) return 'granted';

  const status =
    mediaType === 'microphone' ? getPermissionStatus('microphone') : getScreenCaptureStatus();

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
