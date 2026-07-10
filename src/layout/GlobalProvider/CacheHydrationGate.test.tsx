import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration } from '@/libs/swr/cacheHydration';

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
  // A loading-screen node so the gate's removal side-effect has a target.
  const el = document.createElement('div');
  el.id = 'loading-screen';
  document.body.appendChild(el);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  resetHydration();
  document.getElementById('loading-screen')?.remove();
  vi.useRealTimers();
});

describe('CacheHydrationGate', () => {
  it('blocks first paint (renders nothing) until the active scope is hydrated', () => {
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

  it('timeout backstop releases the app even if hydration never becomes ready', () => {
    vi.useFakeTimers();
    renderGate();
    expect(screen.queryByTestId('app')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('app')).not.toBeNull();
  });
});
