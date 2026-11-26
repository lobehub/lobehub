import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentGraphSupported } from './useAgentGraphSupported';

const mocks = vi.hoisted(() => ({
  agentState: { isCurrentAgentHeterogeneous: false, isInbox: false },
  userState: { preference: { lab: { enableAgentGraphConfig: false } } },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    isCurrentAgentHeterogeneous: (state: typeof mocks.agentState) =>
      state.isCurrentAgentHeterogeneous,
  },
  builtinAgentSelectors: {
    isInboxAgent: (state: typeof mocks.agentState) => state.isInbox,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableAgentGraphConfig: (state: typeof mocks.userState) =>
      state.preference.lab.enableAgentGraphConfig,
  },
}));

describe('useAgentGraphSupported', () => {
  beforeEach(() => {
    mocks.agentState.isInbox = false;
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.userState.preference.lab.enableAgentGraphConfig = false;
  });

  it('is off while the Labs switch is off', () => {
    expect(renderHook(() => useAgentGraphSupported()).result.current).toBe(false);
  });

  it('is on for a custom agent when the Labs switch is on', () => {
    mocks.userState.preference.lab.enableAgentGraphConfig = true;

    expect(renderHook(() => useAgentGraphSupported()).result.current).toBe(true);
  });

  it.each(['isInbox', 'isCurrentAgentHeterogeneous'] as const)(
    'stays off when %s, even with the Labs switch on',
    (flag) => {
      mocks.userState.preference.lab.enableAgentGraphConfig = true;
      mocks.agentState[flag] = true;

      expect(renderHook(() => useAgentGraphSupported()).result.current).toBe(false);
    },
  );
});
