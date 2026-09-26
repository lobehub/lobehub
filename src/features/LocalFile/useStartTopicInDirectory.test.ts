/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStartTopicInDirectory } from './useStartTopicInDirectory';

const mocks = vi.hoisted(() => ({
  commitAgentDefault: vi.fn(),
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
  useCommitWorkingDirectory: () => ({ commitAgentDefault: mocks.commitAgentDefault }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { switchTopic: typeof mocks.switchTopic }) => unknown) =>
    selector({ switchTopic: mocks.switchTopic }),
}));

describe('useStartTopicInDirectory', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts a fresh topic after saving the directory as the agent default', async () => {
    mocks.commitAgentDefault.mockResolvedValue(undefined);
    mocks.switchTopic.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useStartTopicInDirectory({
        isDirectory: true,
        path: '/Users/me/Compositor',
        readonly: false,
      }),
    );

    expect(result.current.canStartTopic).toBe(true);
    await result.current.startTopic();

    expect(mocks.commitAgentDefault).toHaveBeenCalledWith('/Users/me/Compositor');
    expect(mocks.switchTopic).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(mocks.commitAgentDefault.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.switchTopic.mock.invocationCallOrder[0]!,
    );
  });

  it('does not leave the current topic when setting the directory fails', async () => {
    mocks.commitAgentDefault.mockRejectedValue(new Error('write failed'));
    const { result } = renderHook(() =>
      useStartTopicInDirectory({
        isDirectory: true,
        path: '/Users/me/Compositor',
        readonly: false,
      }),
    );

    await result.current.startTopic();

    expect(mocks.toastError).toHaveBeenCalledWith('LocalFile.action.startTopicFailed');
    expect(mocks.switchTopic).not.toHaveBeenCalled();
  });

  it('disables the action for shared directory references', () => {
    const { result } = renderHook(() =>
      useStartTopicInDirectory({
        isDirectory: true,
        path: '/Users/me/Compositor',
        readonly: true,
      }),
    );

    expect(result.current.canStartTopic).toBe(false);
  });
});
