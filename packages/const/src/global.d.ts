/**
 * Build-time defines this package reads. The app builds inject them via Vite
 * `define`; declaring them here (instead of only in the app's global.d.ts)
 * keeps the package compilable from any workspace — e.g. the desktop isolated
 * workspace, whose tsconfig never sees the app's ambient declarations.
 */
declare global {
  /** Vite define: current bundle is the Electron desktop variant */
  const __ELECTRON__: boolean | undefined;
}

export {};
