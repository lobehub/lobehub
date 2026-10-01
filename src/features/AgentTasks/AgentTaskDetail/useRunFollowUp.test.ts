/**
 * @vitest-environment happy-dom
 */
import type { TaskDetailActivity } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRunAgentId, useRunFollowUp } from './useRunFollowUp';

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  canUseResource: true,
  openTopicDrawer: vi.fn(),
  prefetchMessages: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: any) => unknown) =>
    selector({ prefetchMessages: mocks.prefetchMessages, sendMessage: mocks.sendMessage }),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: any) => unknown) =>
    selector({ addComment: mocks.addComment, openTopicDrawer: mocks.openTopicDrawer }),
}));

vi.mock('@/features/Conversation/hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccessForTarget: () => ({
    canUseResource: mocks.canUseResource,
    isAccessLoading: false,
    isGroupContext: false,
  }),
}));

const run = {
  agentId: 'agt_1',
  author: { id: 'agt_1', name: 'Email Agent', type: 'agent' },
  id: 'topic-1',
  status: 'success',
  title: 'Email 通道: lobe.id 邮箱接入',
  type: 'topic',
} as unknown as TaskDetailActivity;

const context = {
  agentId: 'agt_1',
  isolatedTopic: true,
  scope: 'main',
  topicId: 'topic-1',
};

beforeEach(() => {
  mocks.canUseResource = true;
  mocks.prefetchMessages.mockClear();
  mocks.sendMessage.mockClear();
  mocks.openTopicDrawer.mockClear();
  mocks.addComment.mockClear();
});

describe('resolveRunAgentId', () => {
  it('prefers the run author when the run reports an agent', () => {
    expect(
      resolveRunAgentId({ agentId: 'agt_owner', author: { id: 'agt_run', type: 'agent' } } as any),
    ).toBe('agt_run');
  });

  it('falls back to the activity agent for a non-agent author', () => {
    expect(
      resolveRunAgentId({ agentId: 'agt_owner', author: { id: 'usr_1', type: 'user' } } as any),
    ).toBe('agt_owner');
  });

  it('resolves nothing when the run carries no agent', () => {
    expect(resolveRunAgentId({ id: 'topic-1' } as any)).toBeUndefined();
  });
});

describe('useRunFollowUp', () => {
  it('sends the follow-up as a user message in the run topic', async () => {
    const { result } = renderHook(() => useRunFollowUp(run));

    await act(async () => {
      await result.current.submitFollowUp('再补一下 email 通道的联调');
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      context,
      forceRuntime: 'gateway',
      message: '再补一下 email 通道的联调',
    });
  });

  it('hydrates the topic before sending so the message threads onto its history', async () => {
    const { result } = renderHook(() => useRunFollowUp(run));

    await act(async () => {
      await result.current.submitFollowUp('hello');
    });

    expect(mocks.prefetchMessages).toHaveBeenCalledWith(context);
    expect(mocks.prefetchMessages.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendMessage.mock.invocationCallOrder[0],
    );
  });

  it('opens the conversation so the message can be seen where it landed', async () => {
    const { result } = renderHook(() => useRunFollowUp(run));

    await act(async () => {
      await result.current.submitFollowUp('hello');
    });

    expect(mocks.openTopicDrawer).toHaveBeenCalledWith('topic-1', {
      agentId: 'agt_1',
      title: 'Email 通道: lobe.id 邮箱接入',
    });
  });

  it('does not file the follow-up as a task comment', async () => {
    const { result } = renderHook(() => useRunFollowUp(run));

    await act(async () => {
      await result.current.submitFollowUp('hello');
    });

    // A comment is addressed to the task: it reaches the agent only on a later
    // task run and never enters the conversation it was written under.
    expect(mocks.addComment).not.toHaveBeenCalled();
  });

  it('refuses to send when the member may only view the shared topic', async () => {
    mocks.canUseResource = false;
    const { result } = renderHook(() => useRunFollowUp(run));

    expect(result.current.canFollowUp).toBe(false);
    await act(async () => {
      await result.current.submitFollowUp('hello');
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.openTopicDrawer).not.toHaveBeenCalled();
  });

  it('cannot follow up when the run carries no agent to send to', () => {
    const { result } = renderHook(() => useRunFollowUp({ id: 'topic-1' } as any));

    expect(result.current.canFollowUp).toBe(false);
  });
});
