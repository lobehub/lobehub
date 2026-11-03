import { net } from 'electron';

/**
 * Fetch using Electron's net module (Chromium networking stack).
 *
 * Unlike Node.js `fetch`, `net.fetch` respects the OS certificate store
 * (e.g. macOS Keychain, Windows Certificate Store), so self-signed or
 * private-CA certificates trusted at the system level work automatically.
 *
 * This must be called only after `app.whenReady()` has resolved.
 */
export const netFetch: typeof globalThis.fetch = (input, init?) => {
  return net.fetch(input as any, init as any);
};
