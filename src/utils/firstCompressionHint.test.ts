/** @vitest-environment happy-dom */
import { expect, it, vi } from 'vitest';

import { shouldShowFirstCompression } from './firstCompressionHint';

it.each([
  [false, true, true],
  [false, false, false],
  [true, true, false],
  [true, false, false],
])('dismissed=%s, first group=%s: shows hint=%s', (dismissed, first, visible) => {
  expect(shouldShowFirstCompression(dismissed, first)).toBe(visible);
});

it.each([false, true])('remembers dismissal when storage is blocked=%s', async (blocked) => {
  vi.resetModules();
  localStorage.clear();
  const storage = localStorage;
  if (blocked) {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
  }

  try {
    const hint = await import('./firstCompressionHint');
    const listener = vi.fn();
    const unsubscribe = hint.subscribeFirstCompression(listener);
    expect(hint.isFirstCompressionDismissed()).toBe(false);
    hint.dismissFirstCompression();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    expect(hint.isFirstCompressionDismissed()).toBe(true);
    expect(storage.length).toBe(blocked ? 0 : 1);
    if (!blocked) {
      vi.resetModules();
      expect((await import('./firstCompressionHint')).isFirstCompressionDismissed()).toBe(true);
    }
  } finally {
    vi.unstubAllGlobals();
    storage.clear();
  }
});
