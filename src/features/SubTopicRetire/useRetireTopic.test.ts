import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRetireTopicWithSubTopics } from './useRetireTopic';

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  describe: vi.fn(),
  labOn: true,
  navigate: vi.fn(),
  notify: vi.fn(),
  retireTopicTree: vi.fn(),
}));

vi.mock('@/services/subTopic', () => ({ subTopicService: { describe: mocks.describe } }));
vi.mock('./Dialog', () => ({ askRetireSubTopics: mocks.ask }));
vi.mock('./notifyMoved', () => ({ notifyMovedSubTopics: mocks.notify }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector({ retireTopicTree: mocks.retireTopicTree }),
}));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({}) }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableBetterCodingExperience: () => mocks.labOn },
}));

const run = async (action: 'archive' | 'trash' = 'archive', proceed = vi.fn()) => {
  const { result } = renderHook(() => useRetireTopicWithSubTopics());
  await act(() => result.current({ action, proceed, title: 'Release', topicId: 'tpc_a' }));
  return proceed;
};

describe('useRetireTopicWithSubTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.labOn = true;
    mocks.describe.mockResolvedValue({ descendants: 2, direct: 2, running: 1, topicId: 'tpc_a' });
    mocks.retireTopicTree.mockResolvedValue({
      detached: [{ agentId: 'agt_x' }],
      retired: ['tpc_a'],
    });
  });

  it('archives as before when the lab is off', async () => {
    mocks.labOn = false;

    expect(await run()).toHaveBeenCalled();
    expect(mocks.describe).not.toHaveBeenCalled();
  });

  it('archives as before when the topic has no sub-topics', async () => {
    mocks.describe.mockResolvedValue({ descendants: 0, direct: 0, running: 0, topicId: 'tpc_a' });

    expect(await run()).toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('asks, then archives only this one and reports the moved sub-topics', async () => {
    mocks.ask.mockResolvedValue({ mode: 'self', removeFiles: true });

    const proceed = await run();

    expect(mocks.ask).toHaveBeenCalledWith({
      action: 'archive',
      descendants: 2,
      running: 1,
      title: 'Release',
    });
    expect(proceed).not.toHaveBeenCalled();
    expect(mocks.retireTopicTree).toHaveBeenCalledWith('tpc_a', 'archive', 'self', {
      removeFiles: true,
    });
    expect(mocks.notify).toHaveBeenCalledWith([{ agentId: 'agt_x' }], expect.any(Function));
  });

  it('archives everything when asked to', async () => {
    mocks.ask.mockResolvedValue({ mode: 'all', removeFiles: true });

    await run();

    expect(mocks.retireTopicTree).toHaveBeenCalledWith('tpc_a', 'archive', 'all', {
      removeFiles: true,
    });
  });

  it("carries the delete confirm's attachment opt-out into the tree deletion", async () => {
    mocks.ask.mockResolvedValue({ mode: 'self', removeFiles: false });

    await run('trash');

    expect(mocks.retireTopicTree).toHaveBeenCalledWith('tpc_a', 'trash', 'self', {
      removeFiles: false,
    });
  });

  it('does nothing when the dialog is dismissed', async () => {
    mocks.ask.mockResolvedValue(null);

    const proceed = await run();

    expect(proceed).not.toHaveBeenCalled();
    expect(mocks.retireTopicTree).not.toHaveBeenCalled();
  });
});
