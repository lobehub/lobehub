/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStartTopicInDirectory } from './useStartTopicInDirectory';

const mocks = vi.hoisted(() => ({
  activeAgentId: 'agent-1',
  activeTopicId: 'topic-1' as string | null,
  commitAgentDefault: vi.fn(),
  isPreferenceLoading: false,
  switchTopic: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mocks.toastError },
}));

vi.mock('@/features/ChatInput/ControlBar/useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({
    commitAgentDefault: mocks.commitAgentDefault,
    isPreferenceLoading: mocks.isPreferenceLoading,
  }),
}));

vi.mock('@/store/agent', () => {
  const getState = () => ({ activeAgentId: mocks.activeAgentId });
  const useAgentStore = (selector: (state: { activeAgentId: string }) => unknown) =>
    selector(getState());
  useAgentStore.getState = getState;
  return { useAgentStore };
});

vi.mock('@/store/chat', () => {
  const getState = () => ({ activeTopicId: mocks.activeTopicId, switchTopic: mocks.switchTopic });
  const useChatStore = (selector: (state: ReturnType<typeof getState>) => unknown) =>
    selector(getState());
  useChatStore.getState = getState;
  return { useChatStore };
});

const renderStartTopic = (params: Partial<Parameters<typeof useStartTopicInDirectory>[0]> = {}) =>
  renderHook(() =>
    useStartTopicInDirectory({
      conversationAgentId: 'agent-1',
      isDirectory: true,
      path: '/Users/me/Compositor',
      readonly: false,
      ...params,
    }),
  );

describe('useStartTopicInDirectory', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.activeAgentId = 'agent-1';
    mocks.activeTopicId = 'topic-1';
    mocks.isPreferenceLoading = false;
  });

  it('starts a fresh topic after saving the directory as the agent default', async () => {
    mocks.commitAgentDefault.mockResolvedValue(undefined);
    mocks.switchTopic.mockResolvedValue(undefined);
    const { result } = renderStartTopic();

    expect(result.current.canStartTopic).toBe(true);
    await result.current.startTopic();

    // `rethrow` makes a failed save reject instead of being swallowed by the
    // store, so the topic switch below never runs on an unsaved directory.
    expect(mocks.commitAgentDefault).toHaveBeenCalledWith('/Users/me/Compositor', {
      rethrow: true,
      showErrorMessage: false,
    });
    expect(mocks.switchTopic).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(mocks.commitAgentDefault.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.switchTopic.mock.invocationCallOrder[0]!,
    );
  });

  it('does not leave the current topic when setting the directory fails', async () => {
    mocks.commitAgentDefault.mockRejectedValue(new Error('write failed'));
    const { result } = renderStartTopic();

    await result.current.startTopic();

    expect(mocks.toastError).toHaveBeenCalledWith('LocalFile.action.startTopicFailed');
    expect(mocks.switchTopic).not.toHaveBeenCalled();
  });

  it('stays disabled until workspace preferences resolve the target device', async () => {
    mocks.isPreferenceLoading = true;
    const { result } = renderStartTopic();

    expect(result.current.canStartTopic).toBe(false);
    await result.current.startTopic();

    expect(mocks.commitAgentDefault).not.toHaveBeenCalled();
    expect(mocks.switchTopic).not.toHaveBeenCalled();
  });

  it('is unavailable when the rendering conversation is not the active agent', async () => {
    // e.g. a group chat opened from a task: the global active agent is still the
    // task agent, which must not receive this directory as its default.
    mocks.activeAgentId = 'task-agent';
    const { result } = renderStartTopic({ conversationAgentId: 'supervisor-agent' });

    expect(result.current.canStartTopic).toBe(false);
    await result.current.startTopic();

    expect(mocks.commitAgentDefault).not.toHaveBeenCalled();
  });

  it('is unavailable outside a conversation', () => {
    const { result } = renderStartTopic({ conversationAgentId: undefined });

    expect(result.current.canStartTopic).toBe(false);
  });

  it('keeps a topic the user navigated to while the directory was saving', async () => {
    mocks.commitAgentDefault.mockImplementation(async () => {
      mocks.activeTopicId = 'topic-2';
    });
    const { result } = renderStartTopic();

    await result.current.startTopic();

    expect(mocks.commitAgentDefault).toHaveBeenCalled();
    expect(mocks.switchTopic).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('disables the action for shared directory references', () => {
    const { result } = renderStartTopic({ readonly: true });

    expect(result.current.canStartTopic).toBe(false);
  });
});
