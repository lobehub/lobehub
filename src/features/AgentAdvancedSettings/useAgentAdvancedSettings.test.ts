import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentAdvancedSettings } from './useAgentAdvancedSettings';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'agent-1' as string | undefined,
    config: {},
    isCurrentAgentHeterogeneous: false,
    isInbox: false,
    meta: {},
    optimisticUpdateAgentConfig: vi.fn(),
    optimisticUpdateAgentMeta: vi.fn(),
  },
  canEdit: true,
  userState: { preference: { lab: { enableAgentGraphConfig: false } } },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit }),
}));

vi.mock('@/store/agent', () => {
  const useAgentStore = (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState);
  useAgentStore.getState = () => mocks.agentState;

  return { useAgentStore };
});

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: (state: typeof mocks.agentState) => state.config,
    currentAgentMeta: (state: typeof mocks.agentState) => state.meta,
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

describe('useAgentAdvancedSettings', () => {
  beforeEach(() => {
    mocks.agentState.activeAgentId = 'agent-1';
    mocks.agentState.isInbox = false;
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.agentState.optimisticUpdateAgentConfig.mockClear();
    mocks.agentState.optimisticUpdateAgentMeta.mockClear();
    mocks.canEdit = true;
    mocks.userState.preference.lab.enableAgentGraphConfig = false;
  });

  it('leaves the graph section out while its Labs switch is off', () => {
    const { result } = renderHook(() => useAgentAdvancedSettings());

    expect(result.current.showGraph).toBe(false);
  });

  it('shows the graph section for a custom agent when its Labs switch is on', () => {
    mocks.userState.preference.lab.enableAgentGraphConfig = true;

    const { result } = renderHook(() => useAgentAdvancedSettings());

    expect(result.current.showGraph).toBe(true);
  });

  it.each(['isInbox', 'isCurrentAgentHeterogeneous'] as const)(
    'keeps the graph section off when %s, even with its Labs switch on',
    (flag) => {
      mocks.userState.preference.lab.enableAgentGraphConfig = true;
      mocks.agentState[flag] = true;

      const { result } = renderHook(() => useAgentAdvancedSettings());

      expect(result.current.showGraph).toBe(false);
    },
  );

  it('saves config and meta to the active agent', async () => {
    const { result } = renderHook(() => useAgentAdvancedSettings());

    await act(async () => {
      await result.current.updateConfig({ openingMessage: 'hi' });
      await result.current.updateMeta({ title: 'Agent' });
    });

    expect(mocks.agentState.optimisticUpdateAgentConfig).toHaveBeenCalledWith('agent-1', {
      openingMessage: 'hi',
    });
    expect(mocks.agentState.optimisticUpdateAgentMeta).toHaveBeenCalledWith('agent-1', {
      title: 'Agent',
    });
  });

  it('does not save for a member who cannot edit', async () => {
    mocks.canEdit = false;
    const { result } = renderHook(() => useAgentAdvancedSettings());

    await act(async () => {
      await result.current.updateConfig({ openingMessage: 'hi' });
      await result.current.updateMeta({ title: 'Agent' });
    });

    expect(mocks.agentState.optimisticUpdateAgentConfig).not.toHaveBeenCalled();
    expect(mocks.agentState.optimisticUpdateAgentMeta).not.toHaveBeenCalled();
  });
});
