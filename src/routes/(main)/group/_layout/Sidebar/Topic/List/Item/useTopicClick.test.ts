/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTopicClick } from './useTopicClick';

const switchTopicMock = vi.hoisted(() => vi.fn());
const toggleMobileTopicMock = vi.hoisted(() => vi.fn());
const focusTopicPopupMock = vi.hoisted(() => vi.fn(async (_topicId?: string) => false));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: unknown) => unknown) =>
    selector({ activeGroupId: 'grp_test', switchTopic: switchTopicMock }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({ toggleMobileTopic: toggleMobileTopicMock }),
}));
vi.mock('@/features/TopicPopupGuard/useTopicPopupsRegistry', () => ({
  useFocusTopicPopup: () => focusTopicPopupMock,
}));

describe('useTopicClick', () => {
  afterEach(() => {
    vi.useRealTimers();
    switchTopicMock.mockClear();
    toggleMobileTopicMock.mockClear();
    focusTopicPopupMock.mockClear();
  });

  // Desktop used to hold every click back 250ms to tell it apart from the
  // double click that opened a new tab.
  it('switches to the topic on the first click without waiting', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTopicClick({ editing: false, id: 'tpc_test' }));

    await act(async () => {
      void result.current();
      // Only microtasks run here: a delayed single click would still be waiting.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(focusTopicPopupMock).toHaveBeenCalledWith('tpc_test');
    expect(switchTopicMock).toHaveBeenCalledWith('tpc_test');
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });

  it('switches on every click of a rapid repeat', async () => {
    const { result } = renderHook(() => useTopicClick({ editing: false, id: 'tpc_test' }));

    await act(async () => {
      await Promise.all([result.current(), result.current()]);
    });

    expect(switchTopicMock).toHaveBeenCalledTimes(2);
    expect(switchTopicMock).toHaveBeenLastCalledWith('tpc_test');
  });

  it('ignores clicks while the topic is being renamed', async () => {
    const { result } = renderHook(() => useTopicClick({ editing: true, id: 'tpc_test' }));

    await act(async () => {
      await result.current();
    });

    expect(focusTopicPopupMock).not.toHaveBeenCalled();
    expect(switchTopicMock).not.toHaveBeenCalled();
  });
});
