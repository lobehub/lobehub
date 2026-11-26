import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentSettingsPage } from './useAgentSettingsPage';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'agent-1' as string | undefined,
    config: {},
    meta: {},
    optimisticUpdateAgentConfig: vi.fn(),
    optimisticUpdateAgentMeta: vi.fn(),
  },
  canEdit: true,
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
  },
}));

describe('useAgentSettingsPage', () => {
  beforeEach(() => {
    mocks.agentState.activeAgentId = 'agent-1';
    mocks.agentState.optimisticUpdateAgentConfig.mockClear();
    mocks.agentState.optimisticUpdateAgentMeta.mockClear();
    mocks.canEdit = true;
  });

  it('saves config and meta to the active agent', async () => {
    const { result } = renderHook(() => useAgentSettingsPage());

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
    const { result } = renderHook(() => useAgentSettingsPage());

    await act(async () => {
      await result.current.updateConfig({ openingMessage: 'hi' });
      await result.current.updateMeta({ title: 'Agent' });
    });

    expect(mocks.agentState.optimisticUpdateAgentConfig).not.toHaveBeenCalled();
    expect(mocks.agentState.optimisticUpdateAgentMeta).not.toHaveBeenCalled();
  });
});
