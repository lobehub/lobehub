import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setMacWindowFullscreenAttribute } from './macWindowFullscreen';
import { useMacWindowFullscreen } from './useMacWindowFullscreen';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (data: { isFullScreen: boolean }) => void>(),
  isDesktop: true,
  isMac: true,
  isWindowFullScreen: vi.fn(async () => false),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: (data: { isFullScreen: boolean }) => void) => {
    mocks.handlers.set(event, handler);
  },
}));

vi.mock('@/const/version', () => ({
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('@/utils/platform', () => ({
  isMacOS: () => mocks.isMac,
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    isWindowFullScreen: () => mocks.isWindowFullScreen(),
  },
}));

describe('setMacWindowFullscreenAttribute', () => {
  afterEach(() => {
    delete document.documentElement.dataset.windowFullscreen;
  });

  it('marks the document while fullscreen and clears it after leaving', () => {
    setMacWindowFullscreenAttribute(true);

    expect(document.documentElement.getAttribute('data-window-fullscreen')).toBe('');

    setMacWindowFullscreenAttribute(false);

    expect(document.documentElement.hasAttribute('data-window-fullscreen')).toBe(false);
  });
});

describe('useMacWindowFullscreen', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.isDesktop = true;
    mocks.isMac = true;
    mocks.isWindowFullScreen.mockReset();
    mocks.isWindowFullScreen.mockResolvedValue(false);
    delete document.documentElement.dataset.windowFullscreen;
  });

  afterEach(() => {
    delete document.documentElement.dataset.windowFullscreen;
  });

  it('drops the vibrancy background when macOS reports fullscreen', async () => {
    mocks.isWindowFullScreen.mockResolvedValue(true);

    renderHook(() => useMacWindowFullscreen());

    await waitFor(() => {
      expect(document.documentElement.dataset.windowFullscreen).toBe('');
    });

    act(() => mocks.handlers.get('windowFullscreenChanged')?.({ isFullScreen: false }));

    expect(document.documentElement.dataset.windowFullscreen).toBeUndefined();
  });

  it('keeps a newer fullscreen broadcast ahead of a late initial read', async () => {
    let resolveQuery: (isFullScreen: boolean) => void = () => {};
    mocks.isWindowFullScreen.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );

    renderHook(() => useMacWindowFullscreen());

    act(() => mocks.handlers.get('windowFullscreenChanged')?.({ isFullScreen: true }));

    await act(async () => {
      resolveQuery(false);
    });

    expect(document.documentElement.getAttribute('data-window-fullscreen')).toBe('');
  });

  it('ignores fullscreen outside the macOS desktop app', async () => {
    mocks.isMac = false;
    mocks.isWindowFullScreen.mockResolvedValue(true);

    renderHook(() => useMacWindowFullscreen());

    act(() => mocks.handlers.get('windowFullscreenChanged')?.({ isFullScreen: true }));

    expect(document.documentElement.dataset.windowFullscreen).toBeUndefined();
    expect(mocks.isWindowFullScreen).not.toHaveBeenCalled();
  });
});
