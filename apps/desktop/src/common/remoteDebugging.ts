/**
 * Renderer argument the main process adds while Chromium remote debugging (CDP) is on.
 * The preload reads it to tell the renderer to register its Zustand stores on
 * `window.__LOBE_STORES`, so a CDP client can read state snapshots from a packaged build.
 */
export const EXPOSE_STORES_ARG = '--lobe-expose-stores';

export const readExposeStoresArg = (argv: readonly string[]): boolean =>
  argv.includes(EXPOSE_STORES_ARG);
