'use client';

/**
 * Web no-op. The desktop build swaps in `ElectronAppStateSync.desktop.tsx`,
 * which hydrates the electron app state (shell, user paths) into the store and
 * the global agent context, and keeps them fresh via main-process broadcasts.
 */
const ElectronAppStateSync = () => null;

export default ElectronAppStateSync;
