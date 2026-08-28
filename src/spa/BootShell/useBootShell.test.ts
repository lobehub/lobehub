import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAppPainted, setAppReady } from '@/spa/atoms/app';

import { BOOT_SHELL_DELAY } from './phase';
import { useBootShell } from './useBootShell';

const queryLoadingScreen = () => document.getElementById('loading-screen');

const seedLoadingScreen = () => {
  const el = document.createElement('div');
  el.id = 'loading-screen';
  document.body.append(el);
};

const finishBoot = () =>
  act(() => {
    setAppReady(true);
    setAppPainted(true);
  });

const elapse = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  setAppReady(false);
  setAppPainted(false);
  seedLoadingScreen();
});

afterEach(() => {
  setAppReady(false);
  setAppPainted(false);
  queryLoadingScreen()?.remove();
  vi.useRealTimers();
});

describe('useBootShell', () => {
  it('keeps the static logo up and draws nothing before the delay elapses', () => {
    const { result } = renderHook(() => useBootShell());

    expect(result.current).toBe('hidden');
    expect(queryLoadingScreen()).not.toBeNull();

    elapse(BOOT_SHELL_DELAY - 1);

    expect(result.current).toBe('hidden');
    expect(queryLoadingScreen()).not.toBeNull();
  });

  it('a warm boot never flashes the shell — the logo hands straight over to the app', () => {
    const { result } = renderHook(() => useBootShell());

    finishBoot();

    expect(result.current).toBe('done');
    expect(queryLoadingScreen()).toBeNull();

    // the pending delay timer must not resurrect the shell after the app painted
    elapse(BOOT_SHELL_DELAY * 10);

    expect(result.current).toBe('done');
  });

  it('replaces the logo with the shell on a cold boot, then finishes once painted', () => {
    const { result } = renderHook(() => useBootShell());

    elapse(BOOT_SHELL_DELAY);

    expect(result.current).toBe('shell');
    expect(queryLoadingScreen()).toBeNull();

    finishBoot();

    expect(result.current).toBe('done');
  });

  it('holds the shell until BOTH the ready and painted signals land', () => {
    const { result } = renderHook(() => useBootShell());

    elapse(BOOT_SHELL_DELAY);

    act(() => {
      setAppReady(true);
    });
    expect(result.current).toBe('shell');

    act(() => {
      setAppPainted(true);
    });
    expect(result.current).toBe('done');
  });

  it('tolerates a missing loading screen', () => {
    queryLoadingScreen()!.remove();

    const { result } = renderHook(() => useBootShell());
    elapse(BOOT_SHELL_DELAY);

    expect(result.current).toBe('shell');
  });
});
