import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ForwardTopicParams } from '@/store/chat/slices/forward/action';

import { useForwardTopic } from './useForwardTopic';

const mocks = vi.hoisted(() => ({
  clearPortalStack: vi.fn(),
  forwardTopic: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: mocks.error, success: mocks.success } }));

describe('topic handoff acceptance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('navigates only to the primary target while target runs are pending', async () => {
    let params!: ForwardTopicParams;
    let finish!: () => void;
    mocks.forwardTopic.mockImplementation((input: ForwardTopicParams) => {
      params = input;
      return new Promise((resolve) => {
        finish = () => resolve({ succeeded: [{ agentId: 'b' }, { agentId: 'c' }], failed: [] });
      });
    });
    const { result } = renderHook(() => useForwardTopic({ agentId: 'a', topicId: 'source' }));
    act(() => result.current([{ id: 'b' }, { id: 'c' }]));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => {
      await params.onTopicCreated?.({ id: 'c' }, 'topic-c');
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => {
      await params.onTopicCreated?.({ id: 'b' }, 'topic-b');
    });
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it('explains that the source schedule stays paused after an ambiguous send', async () => {
    mocks.forwardTopic.mockResolvedValue({
      succeeded: [],
      failed: [{ agentId: 'b' }],
      sourceSchedulePaused: true,
    });
    const { result } = renderHook(() =>
      useForwardTopic({ agentId: 'a', topicId: 'source', cancelSourceContinuation: true }),
    );
    await act(async () => result.current([{ id: 'b' }]));
    expect(mocks.error).toHaveBeenCalledWith('messageForward.topic.sourceSchedulePaused');
  });

  it('does not navigate when every target fails before persistence', async () => {
    mocks.forwardTopic.mockResolvedValue({ succeeded: [], failed: [{ agentId: 'b' }] });
    const { result } = renderHook(() => useForwardTopic({ agentId: 'a', topicId: 'source' }));
    await act(async () => result.current([{ id: 'b' }]));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
});
