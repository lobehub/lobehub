import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration } from '@/libs/swr/cacheHydration';

// Import after mocks are registered.
import CacheHydrationGate from './CacheHydrationGate';

// --- controllable inputs -----------------------------------------------------
let mockScope = 'anon:personal';
let mockIsAuthLoaded = true;
let mockUserId: string | undefined = 'u1';

vi.mock('@/libs/swr/useCacheScope', () => ({
  useCacheScope: () => mockScope,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: any) => unknown) =>
    selector({ isLoaded: mockIsAuthLoaded, user: { id: mockUserId } }),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLoaded: (s: any) => s.isLoaded },
  userProfileSelectors: { userId: (s: any) => s.user?.id },
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
  mockIsAuthLoaded = true;
  mockUserId = 'u1';
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

  it('first paint waits for userId to resolve even when cache is ready', () => {
    mockUserId = undefined;
    renderGate();

    act(() => {
      cacheHydration.markReady('anon:personal');
    });
    // cache ready + auth loaded, but identity round-trip not done → still blocked
    expect(screen.queryByTestId('app')).toBeNull();

    // Resolve identity and drive a genuine hydration snapshot change so the gate
    // re-renders and re-evaluates the release condition.
    act(() => {
      mockUserId = 'u1';
      cacheHydration.markPending('anon:personal'); // ready: true → false (re-render, still !ready)
    });
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      cacheHydration.markReady('anon:personal'); // ready: false → true → release
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('timeout backstop releases the app once identity is resolved even if cache never hydrates', () => {
    vi.useFakeTimers();
    mockUserId = 'u1';
    // cache scope is never marked ready
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });

  it('REGRESSION: stays blocked past the timeout when userId is unresolved (no anon release)', () => {
    vi.useFakeTimers();
    mockUserId = undefined;
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    // The old behavior released into the anonymous scope here — orphaning any
    // data fetched under it. The userId guard now precedes the timeout backstop.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('app')).toBeNull();
    expect(document.getElementById('loading-screen')).not.toBeNull();

    // Identity resolves later (incl. via SWR focus/reconnect revalidation) → release.
    act(() => {
      mockUserId = 'u1';
      cacheHydration.markReady('anon:personal');
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });
});
