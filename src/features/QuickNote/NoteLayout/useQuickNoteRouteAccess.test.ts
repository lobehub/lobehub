import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQuickNoteRouteAccess } from './useQuickNoteRouteAccess';

const mocks = vi.hoisted(() => ({
  enableQuickNote: false,
  serverConfigInit: false,
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (
    selector: (s: {
      featureFlags: { enableQuickNote: boolean };
      serverConfigInit: boolean;
    }) => unknown,
  ) =>
    selector({
      featureFlags: { enableQuickNote: mocks.enableQuickNote },
      serverConfigInit: mocks.serverConfigInit,
    }),
}));

afterEach(() => {
  mocks.enableQuickNote = false;
  mocks.serverConfigInit = false;
});

/** @example Direct links wait for resolved flags before entering or leaving Note. */
describe('useQuickNoteRouteAccess', () => {
  it.each([
    [true, 'allowed'],
    [false, 'denied'],
  ] as const)('resolves a direct route with enabled=%s to %s', (enabled, expectedAccess) => {
    mocks.enableQuickNote = enabled;
    const view = renderHook(() => useQuickNoteRouteAccess());

    /** @example Unresolved configuration must not prematurely redirect a tester. */
    expect(view.result.current).toBe('pending');

    mocks.serverConfigInit = true;
    view.rerender();

    /** @example Enabled users enter Note, while denied users return to the parent route. */
    expect(view.result.current).toBe(expectedAccess);
  });
});
