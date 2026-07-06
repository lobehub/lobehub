import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration } from '@/libs/swr/cacheHydration';

// Import after mocks are registered.
import CacheHydrationGate from './CacheHydrationGate';

// --- controllable inputs -----------------------------------------------------
let mockScope = 'anon:personal';
let mockIsAuthLoaded = true;
let mockIsUserStateInit = true;
let mockIsDesktop = false;

vi.mock('@/libs/swr/useCacheScope', () => ({
  useCacheScope: () => mockScope,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: any) => unknown) =>
    selector({ isLoaded: mockIsAuthLoaded, isUserStateInit: mockIsUserStateInit }),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLoaded: (s: any) => s.isLoaded },
}));

vi.mock('@/libs/bootTiming', () => ({
  bootTiming: { mark: vi.fn() },
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mockIsDesktop;
  },
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
  mockIsAuthLoaded = true;
  mockIsUserStateInit = true;
  mockIsDesktop = false;
  resetHydration();
  // A loading-screen node so the gate's removal side-effect has a target.
  const el = document.createElement('div');
  el.id = 'loading-screen';
  document.body.appendChild(el);
});

afterEach(() => {
  resetHydration();
  document.getElementById('loading-screen')?.remove();
  vi.useRealTimers();
});

describe('CacheHydrationGate', () => {
  it('blocks first paint (renders nothing) until the initial scope is ready', () => {
    // web path (isDesktop=false): released needs isAuthLoaded && ready
    renderGate();
    // not ready yet → blocked
    expect(screen.queryByTestId('app')).toBeNull();
    expect(document.getElementById('loading-screen')).not.toBeNull();

    act(() => {
      cacheHydration.markReady('anon:personal');
    });

    expect(screen.queryByTestId('app')).not.toBeNull();
    // loading-screen removed once released
    expect(document.getElementById('loading-screen')).toBeNull();
  });

  it('CORE: after first release, a scope change does NOT unmount the app (no white-screen)', () => {
    renderGate();
    act(() => {
      cacheHydration.markReady('anon:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();

    // Simulate login: scope flips to the signed-in user, whose cache is NOT yet
    // hydrated (markPending / never marked ready). The old key={scope} remount
    // would blank the whole tree here.
    act(() => {
      mockScope = 'u1:personal';
      cacheHydration.markPending('u1:personal'); // new scope not ready
      // force a re-render through the hydration store subscription
      cacheHydration.markReady('anon:personal');
    });

    // App stays mounted throughout the scope change — this is the invariant that
    // prevents the reported full-screen white flash on login.
    expect(screen.queryByTestId('app')).not.toBeNull();

    // Even after the new scope finishes hydrating, still mounted (never blanked).
    act(() => {
      cacheHydration.markReady('u1:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('desktop first paint waits for isUserStateInit even when cache is ready', () => {
    mockIsDesktop = true;
    mockIsUserStateInit = false;
    renderGate();

    act(() => {
      cacheHydration.markReady('anon:personal');
    });
    // cache ready + auth loaded, but identity round-trip not done → still blocked
    expect(screen.queryByTestId('app')).toBeNull();

    // Flip identity to resolved and drive a genuine hydration snapshot change so
    // the gate re-renders and re-evaluates the release condition.
    act(() => {
      mockIsUserStateInit = true;
      cacheHydration.markPending('anon:personal'); // ready: true → false (re-render, still !ready)
    });
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      cacheHydration.markReady('anon:personal'); // ready: false → true → release
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('timeout backstop releases the app even if hydration never becomes ready', () => {
    vi.useFakeTimers();
    mockIsDesktop = true;
    mockIsUserStateInit = false; // would otherwise block forever on desktop
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });
});
