import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { getAppPainted, setAppPainted, setAppReady } from '@/spa/atoms/app';

// Import after mocks are registered.
import CacheHydrationGate from './CacheHydrationGate';

// --- controllable inputs -----------------------------------------------------
let mockScope = 'anon:personal';

vi.mock('@/libs/swr/useCacheScope', () => ({
  useCacheScope: () => mockScope,
}));

vi.mock('@/libs/bootTiming', () => ({
  bootTiming: { mark: vi.fn() },
}));

const ALL_SCOPES = ['anon:personal', 'u1:personal', 'u2:personal'];
const resetHydration = () => ALL_SCOPES.forEach((s) => cacheHydration.markPending(s));

const Child = () => <div data-testid="app">app content</div>;

const renderGate = () =>
  render(
    <CacheHydrationGate>
      <Child />
    </CacheHydrationGate>,
  );

beforeEach(() => {
  mockScope = 'anon:personal';
  resetHydration();
  setAppPainted(false);
  setAppReady(true);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  resetHydration();
  setAppPainted(false);
  setAppReady(false);
  vi.useRealTimers();
});

describe('CacheHydrationGate', () => {
  it('blocks first paint (renders nothing) until the active scope is hydrated', () => {
    renderGate();
    // not ready yet → blocked
    expect(screen.queryByTestId('app')).toBeNull();
    expect(getAppPainted()).toBe(false);

    act(() => {
      cacheHydration.markReady('anon:personal');
    });

    expect(screen.queryByTestId('app')).not.toBeNull();
    // signals the boot shell to tear down once the real app has committed
    expect(getAppPainted()).toBe(true);
  });

  it('CORE: after first release, a scope change does NOT unmount the app (no white-screen)', () => {
    renderGate();
    act(() => {
      cacheHydration.markReady('anon:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();

    // Simulate the session resolving a different scope whose cache is NOT yet
    // hydrated. The old key={scope} remount would blank the whole tree here.
    act(() => {
      mockScope = 'u1:personal';
      cacheHydration.markPending('u1:personal'); // new scope not ready
      cacheHydration.markReady('anon:personal'); // force a re-render via the store
    });

    // App stays mounted throughout the scope change.
    expect(screen.queryByTestId('app')).not.toBeNull();

    act(() => {
      cacheHydration.markReady('u1:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('releases the moment the active scope is ready — no identity round-trip wait', () => {
    // The persisted activeScopeKey means the hydrated scope is already the real
    // user partition, so the gate must not wait for auth/userId — only `ready`.
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      cacheHydration.markReady('anon:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('does NOT paint early while hydration is still in flight (no empty-chat + CLS)', () => {
    // A heavy account's hydration outruns the former 1500ms window; painting then
    // orphans any consumer that subscribes against the still-empty Map.
    vi.useFakeTimers();
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2500); // well past 1500ms, still not ready
    });
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      cacheHydration.markReady('anon:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('tears down the static loading screen for entries that mount no boot shell', () => {
    // The Electron popup entry renders no `BootShell`, and `popup.html` ships an
    // opaque z-index 99999 `#loading-screen`. `useBootShell` is what normally
    // removes it, so the gate has to be the backstop or the popup stays covered
    // forever after hydration.
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'loading-screen';
    document.body.append(loadingScreen);

    renderGate();
    expect(document.getElementById('loading-screen')).not.toBeNull();

    act(() => {
      cacheHydration.markReady('anon:personal');
    });

    expect(document.getElementById('loading-screen')).toBeNull();
  });

  it('holds the static loading screen until the app can actually paint', () => {
    // Hydration can finish before initialization. In that window `AppLayer`
    // renders null and the boot shell's phase is still `hidden` (it needs BOTH
    // signals, and the 200ms timer has not fired), so tearing the splash down on
    // release alone leaves the window blank.
    setAppReady(false);
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'loading-screen';
    document.body.append(loadingScreen);

    renderGate();
    act(() => {
      cacheHydration.markReady('anon:personal');
    });

    expect(document.getElementById('loading-screen')).not.toBeNull();

    act(() => {
      setAppReady(true);
    });

    expect(document.getElementById('loading-screen')).toBeNull();
  });

  it('hung-hydration backstop still releases if ready never fires', () => {
    vi.useFakeTimers();
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });
});
