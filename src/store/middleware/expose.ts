import { isDev } from '@/utils/env';

/**
 * In development, registers the store on `window.__LOBE_STORES[name]` as a getter that returns
 * the current snapshot from `store.getState()`.
 */
export function expose<T>(name: string, store: { getState: () => T }): void {
  if (!isDev || typeof window === 'undefined') return;

  window.__LOBE_STORES ??= {};
  window.__LOBE_STORES[name] = () => store.getState();
}
