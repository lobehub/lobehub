import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentLabGate } from './useAgentLabGate';

/**
 * The lab gate reads `preference.lab.enableTopicAcceptance`, which is `false`
 * until `useInitUserState` resolves. Before the gate split "still loading"
 * from "settled off" via `isPreferenceInit`, the initial `false` rendered
 * `null` (a white flash inside the agent layout) and the redirect effect
 * kicked cold-boot visitors back to chat before their preference ever arrived.
 */
const userStateMock: {
  initError?: unknown;
  isUserStateInit?: boolean;
  preference: { lab?: { enableTopicAcceptance?: boolean } };
} = { preference: {} };

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      isUserStateInit: userStateMock.isUserStateInit,
      isUserStateInitError: userStateMock.initError,
      preference: userStateMock.preference,
    }),
}));

beforeEach(() => {
  userStateMock.initError = undefined;
  userStateMock.isUserStateInit = true;
  userStateMock.preference = {};
});

describe('useAgentLabGate', () => {
  it('reports the gate as unjudged while preference is still initializing', () => {
    userStateMock.isUserStateInit = false;

    const { result } = renderHook(() => useAgentLabGate());

    expect(result.current.isPreferenceInit).toBe(false);
    expect(result.current.shouldRedirect).toBe(false);
  });

  it('opens the gate once preference settles with the lab enabled', () => {
    userStateMock.preference = { lab: { enableTopicAcceptance: true } };

    const { result } = renderHook(() => useAgentLabGate());

    expect(result.current).toEqual({
      enabled: true,
      initFailed: false,
      isPreferenceInit: true,
      shouldRedirect: false,
    });
  });

  it('redirects only after preference confirms the lab is off', () => {
    userStateMock.preference = { lab: { enableTopicAcceptance: false } };

    const { result } = renderHook(() => useAgentLabGate());

    expect(result.current.shouldRedirect).toBe(true);
  });

  it('redirects even when user state failed to initialize, so the page is not a dead end', () => {
    userStateMock.initError = new Error('offline');
    userStateMock.isUserStateInit = false;

    const { result } = renderHook(() => useAgentLabGate());

    // The gate itself stays unjudged — the route reads `isUserStateInitError`
    // separately and falls through to the redirect instead of hanging forever.
    expect(result.current.isPreferenceInit).toBe(false);
  });
});
