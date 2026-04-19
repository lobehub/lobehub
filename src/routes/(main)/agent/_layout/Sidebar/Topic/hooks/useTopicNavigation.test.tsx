/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicNavigation } from './useTopicNavigation';

const switchTopicMock = vi.hoisted(() => vi.fn());
const toggleMobileTopicMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const pathnameMock = vi.hoisted(() => vi.fn());
const focusTopicPopupMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/TopicPopupGuard/useTopicPopupsRegistry', () => ({
  useFocusTopicPopup: () => focusTopicPopupMock,
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/libs/router/navigation', () => ({
  usePathname: pathnameMock,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeAgentId: 'agent-1',
      switchTopic: switchTopicMock,
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      toggleMobileTopic: toggleMobileTopicMock,
    }),
}));

describe('useTopicNavigation', () => {
  beforeEach(() => {
    pathnameMock.mockReset();
    focusTopicPopupMock.mockReset();
    pushMock.mockReset();
    switchTopicMock.mockReset();
    toggleMobileTopicMock.mockReset();
  });

  it('focuses the popup and still navigates back to the chat route when the topic is detached', async () => {
    pathnameMock.mockReturnValue('/agent/agent-1/profile');
    focusTopicPopupMock.mockResolvedValue(true);

    const { result } = renderHook(() => useTopicNavigation());

    await act(async () => {
      await result.current.navigateToTopic('topic-in-popup');
    });

    expect(focusTopicPopupMock).toHaveBeenCalledWith('topic-in-popup');
    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1?topic=topic-in-popup');
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });

  it('falls back to the original sub-route navigation when no popup exists', async () => {
    pathnameMock.mockReturnValue('/agent/agent-1/profile');
    focusTopicPopupMock.mockResolvedValue(false);

    const { result } = renderHook(() => useTopicNavigation());

    await act(async () => {
      await result.current.navigateToTopic('topic-2');
    });

    expect(focusTopicPopupMock).toHaveBeenCalledWith('topic-2');
    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1?topic=topic-2');
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });

  it('switches the main window topic after focusing the popup on the base route', async () => {
    pathnameMock.mockReturnValue('/agent/agent-1');
    focusTopicPopupMock.mockResolvedValue(true);

    const { result } = renderHook(() => useTopicNavigation());

    await act(async () => {
      await result.current.navigateToTopic('topic-3');
    });

    expect(focusTopicPopupMock).toHaveBeenCalledWith('topic-3');
    expect(pushMock).not.toHaveBeenCalled();
    expect(switchTopicMock).toHaveBeenCalledWith('topic-3');
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });
});
