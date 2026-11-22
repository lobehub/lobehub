import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentSettingsModal } from './useAgentSettingsModal';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  openAgentSettingsModal: vi.fn(),
}));

vi.mock('@/routes/(main)/agent/profile/features/AgentSettings', () => ({
  openAgentSettingsModal: mocks.openAgentSettingsModal,
}));

describe('useAgentSettingsModal', () => {
  beforeEach(() => {
    mocks.close.mockClear();
    mocks.openAgentSettingsModal.mockReset();
    mocks.openAgentSettingsModal.mockReturnValue({ close: mocks.close });
  });

  it('opens the advanced settings modal', async () => {
    const { result } = renderHook(() => useAgentSettingsModal('agt_1'));

    await act(() => result.current());

    expect(mocks.openAgentSettingsModal).toHaveBeenCalledTimes(1);
  });

  it('closes the modal when the sidebar moves to another agent', async () => {
    const { rerender, result } = renderHook(({ agentId }) => useAgentSettingsModal(agentId), {
      initialProps: { agentId: 'agt_1' },
    });
    await act(() => result.current());

    rerender({ agentId: 'agt_2' });

    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('does not open a modal once the sidebar has left the profile group', async () => {
    const { result, unmount } = renderHook(() => useAgentSettingsModal('agt_1'));

    const pending = result.current();
    unmount();
    await pending;

    expect(mocks.openAgentSettingsModal).not.toHaveBeenCalled();
  });
});
