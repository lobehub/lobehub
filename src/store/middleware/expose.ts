import { isDev } from '@/utils/env';

/**
 * Registers the store on `window.__LOBE_STORES[name]` as a getter that returns the current
 * snapshot from `store.getState()`. Runs in development, and in Desktop builds while remote
 * debugging is on: the preload sets `lobeEnv.exposeStores` before any store module loads, and
 * a CDP client can already evaluate code in the page, so the snapshots add no access.
 */
export function expose<T>(name: string, store: { getState: () => T }): void {
  if (typeof window === 'undefined') return;
  if (!isDev && !window.lobeEnv?.exposeStores) return;

  window.__LOBE_STORES ??= {};
  window.__LOBE_STORES[name] = () => store.getState();
}
