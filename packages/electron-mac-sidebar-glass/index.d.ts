/// <reference types="node" />

/** Whether the native addon and AppKit Liquid Glass are available (macOS 26+). */
export declare function isSupported(): boolean;

/**
 * Set the window background material beneath its web contents.
 * Uses BrowserWindow.getNativeWindowHandle(); call only on Electron's main thread.
 * Disabling releases the material. Window destruction also releases it automatically.
 * Returns false on failure so the caller can retain Electron sidebar vibrancy.
 */
export declare function setWindowGlass(
  nativeWindowHandle: Buffer,
  enabled: boolean,
  dark: boolean,
): boolean;
