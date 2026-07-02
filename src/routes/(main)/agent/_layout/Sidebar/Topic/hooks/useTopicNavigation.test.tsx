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
const chatStoreStateMock = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string | undefined,
  activeTopicId: undefined as string | undefined,
  switchTopic: undefined as unknown,
}));
const workspaceStoreStateMock = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  workspaces: [{ id: 'workspace-1', slug: 'team' }],
}));

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
    selector(chatStoreStateMock as unknown as Record<string, unknown>),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      toggleMobileTopic: toggleMobileTopicMock,
    }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () =>
    workspaceStoreStateMock.workspaces.find(
      (workspace) => workspace.id === workspaceStoreStateMock.activeWorkspaceId,
    )?.slug ?? null,
}));

describe('useTopicNavigation', () => {
  beforeEach(() => {
    pathnameMock.mockReset();
    focusTopicPopupMock.mockReset();
    pushMock.mockReset();
    switchTopicMock.mockReset();
    toggleMobileTopicMock.mockReset();
    chatStoreStateMock.activeAgentId = 'agent-1';
    chatStoreStateMock.activeTopicId = undefined;
    chatStoreStateMock.switchTopic = switchTopicMock;
    workspaceStoreStateMock.activeWorkspaceId = null;
  });

  it('focuses the popup and still navigates back to the chat route when the topic is detached', async () => {
    pathnameMock.mockReturnValue('/agent/agent-1/profile');
    focusTopicPopupMock.mockResolvedValue(true);

    const { result } = renderHook(() => useTopicNavigation());

    await act(async () => {
      await result.current.navigateToTopic('topic-in-popup');
    });

    expect(focusTopicPopupMock).toHaveBeenCalledWith('topic-in-popup');
    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1/topic-in-popup');
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
    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1/topic-2');
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

  it('switches topics in place on an exact topic route', async () => {
    pathnameMock.mockReturnValue('/agent/agent-1/topic-1');
    chatStoreStateMock.activeTopicId = 'topic-1';
    focusTopicPopupMock.mockResolvedValue(false);

    const { result } = renderHook(() => useTopicNavigation());

    expect(result.current.isInTopicContextRoute).toBe(true);
    expect(result.current.isInAgentSubRoute).toBe(false);

    await act(async () => {
      await result.current.navigateToTopic('topic-2');
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(switchTopicMock).toHaveBeenCalledWith('topic-2');
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });

  it('routes to the next topic from a topic child route instead of leaving the URL on the child route', async () => {
    pathnameMock.mockReturnValue('/agent/agent-1/topic-1/page');
    chatStoreStateMock.activeTopicId = 'topic-1';
    focusTopicPopupMock.mockResolvedValue(false);

    const { result } = renderHook(() => useTopicNavigation());

    expect(result.current.isInTopicContextRoute).toBe(true);
    expect(result.current.isInAgentSubRoute).toBe(true);

    await act(async () => {
      await result.current.navigateToTopic('topic-2');
    });

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1/topic-2');
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });

  it('still routes back to chat from a profile sub-route even when activeTopicId is cached', async () => {
    // regression: cached activeTopicId should not make profile look like a topic route
    pathnameMock.mockReturnValue('/agent/agent-1/profile');
    chatStoreStateMock.activeTopicId = 'cached-topic';
    focusTopicPopupMock.mockResolvedValue(false);

    const { result } = renderHook(() => useTopicNavigation());

    expect(result.current.isInAgentSubRoute).toBe(true);

    await act(async () => {
      await result.current.navigateToTopic('topic-click');
    });

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1/topic-click');
    expect(switchTopicMock).not.toHaveBeenCalled();
  });

  it('routes back to chat from a workspace-prefixed profile sub-route', async () => {
    workspaceStoreStateMock.activeWorkspaceId = 'workspace-1';
    pathnameMock.mockReturnValue('/team/agent/agent-1/profile');
    focusTopicPopupMock.mockResolvedValue(false);

    const { result } = renderHook(() => useTopicNavigation());

    expect(result.current.isInAgentSubRoute).toBe(true);

    await act(async () => {
      await result.current.navigateToTopic('topic-workspace');
    });

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1/topic-workspace');
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });

  it('preserves a detected route prefix when routing from a prefixed profile path without an active workspace slug', async () => {
    pathnameMock.mockReturnValue('/lobehub/agent/agent-1/profile');
    focusTopicPopupMock.mockResolvedValue(false);

    const { result } = renderHook(() => useTopicNavigation());

    expect(result.current.isInAgentSubRoute).toBe(true);

    await act(async () => {
      await result.current.navigateToTopic('topic-prefixed');
    });

    expect(pushMock).toHaveBeenCalledWith('/lobehub/agent/agent-1/topic-prefixed');
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(toggleMobileTopicMock).toHaveBeenCalledWith(false);
  });
});
