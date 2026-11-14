/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppPainted, setAppPainted, setAppReady } from '@/spa/atoms/app';

import { usePrePaintSignal } from './usePrePaintSignal';

vi.mock('@/libs/bootTiming', () => ({
  bootTiming: { mark: vi.fn() },
}));

const mountLoadingScreen = () => {
  const loadingScreen = document.createElement('div');
  loadingScreen.id = 'loading-screen';
  document.body.append(loadingScreen);
};

beforeEach(() => {
  setAppPainted(false);
  setAppReady(true);
});

afterEach(() => {
  document.getElementById('loading-screen')?.remove();
  setAppPainted(false);
  setAppReady(false);
});

describe('usePrePaintSignal', () => {
  it('reports the first paint on the first commit, without waiting for any cache hydration', () => {
    renderHook(() => usePrePaintSignal());

    expect(getAppPainted()).toBe(true);
  });

  it('records the first-paint boot mark once per page load', async () => {
    // The mark is first-write-wins for the module, so load a fresh copy.
    vi.resetModules();
    const { bootTiming } = await import('@/libs/bootTiming');
    const { usePrePaintSignal: freshUsePrePaintSignal } = await import('./usePrePaintSignal');

    renderHook(() => freshUsePrePaintSignal()).unmount();
    renderHook(() => freshUsePrePaintSignal());

    expect(
      vi.mocked(bootTiming.mark).mock.calls.filter(([name]) => name === 'first-paint'),
    ).toEqual([['first-paint']]);
  });

  it('tears down the static loading screen for entries that mount no boot shell', () => {
    // The Electron popup renders no `BootShell`, and `popup.html` ships an
    // opaque z-index 99999 `#loading-screen` that swallows clicks.
    mountLoadingScreen();

    renderHook(() => usePrePaintSignal());

    expect(document.getElementById('loading-screen')).toBeNull();
  });

  it('holds the static loading screen until initialization is done', () => {
    // Before `appReady`, `AppLayer` renders null and the boot shell may still
    // be hidden: removing the splash then would blank the window.
    setAppReady(false);
    mountLoadingScreen();

    renderHook(() => usePrePaintSignal());
    expect(document.getElementById('loading-screen')).not.toBeNull();

    act(() => setAppReady(true));

    expect(document.getElementById('loading-screen')).toBeNull();
  });
});
