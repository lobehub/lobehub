import { type EmbedTheme, isEmbedTheme } from '@lobechat/embed/protocol';
import { useSyncExternalStore } from 'react';

/**
 * Theme the host website picked for an embedded conversation.
 *
 * Forced on next-themes instead of set through `setTheme`, which would persist
 * it as the visitor's own LobeHub preference: the iframe shares storage with
 * every other LobeHub tab of that visitor. `undefined` outside embed pages, so
 * the app keeps its normal theme handling.
 */
let embedTheme: EmbedTheme | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Seed from the iframe URL (`?theme=`) so the first paint already matches the host. */
export const initEmbedTheme = (search: string) => {
  const param = new URLSearchParams(search).get('theme');
  embedTheme = isEmbedTheme(param) ? param : 'auto';
  emit();
};

/** Leaving the embed page hands the theme back to the visitor's own preference. */
export const clearEmbedTheme = () => {
  if (embedTheme === undefined) return;
  embedTheme = undefined;
  emit();
};

export const setEmbedTheme = (theme: EmbedTheme) => {
  if (theme === embedTheme) return;
  embedTheme = theme;
  emit();
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const media = typeof window === 'undefined' ? undefined : window.matchMedia?.(DARK_QUERY);
  media?.addEventListener('change', listener);

  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', listener);
  };
};

const getSnapshot = (): 'dark' | 'light' | undefined => {
  if (!embedTheme) return undefined;
  if (embedTheme !== 'auto') return embedTheme;

  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
};

/** next-themes `forcedTheme` for the current page: the host's theme on embed pages, else none. */
export const useEmbedForcedTheme = () =>
  useSyncExternalStore(subscribe, getSnapshot, () => undefined);
