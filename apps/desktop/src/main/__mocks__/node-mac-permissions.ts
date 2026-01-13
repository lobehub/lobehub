/**
 * Mock for node-mac-permissions native module
 * Used in tests since the native module only works on macOS
 */

import { vi } from 'vitest';

export const askForAccessibilityAccess = vi.fn(() => undefined);
export const askForCalendarAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForCameraAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForContactsAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForFoldersAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForFullDiskAccess = vi.fn(() => undefined);
export const askForInputMonitoringAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForLocationAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForMicrophoneAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForPhotosAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForRemindersAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForSpeechRecognitionAccess = vi.fn(() => Promise.resolve('authorized'));
export const askForScreenCaptureAccess = vi.fn(() => undefined);
export const getAuthStatus = vi.fn(() => 'authorized');
