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
  sendMessage: vi.fn(),
  toastError: vi.fn(),
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

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.toastError } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

/** The happy path: the server takes ownership and reports acceptance. */
const acceptSend = () => {
  mocks.sendMessage.mockImplementation(async (params: any) => {
    params?.onMessageAccepted?.();
    return { assistantMessageId: 'msg_a', userMessageId: 'msg_u' };
  });
};

/**
 * A gateway/network refusal to start the run: `sendMessage` catches the failure
 * and resolves `undefined` without ever accepting the message.
 */
const refuseSend = () => {
  mocks.sendMessage.mockResolvedValue(undefined);
};

beforeEach(() => {
  mocks.canUseResource = true;
  mocks.prefetchMessages.mockClear();
  mocks.sendMessage.mockReset();
  mocks.openTopicDrawer.mockClear();
  mocks.addComment.mockClear();
  mocks.toastError.mockClear();
  acceptSend();
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

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.submitFollowUp('再补一下 email 通道的联调');
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        forceRuntime: 'gateway',
        message: '再补一下 email 通道的联调',
      }),
    );
    expect(sent).toBe(true);
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

  it('does not hand the send a composer editor to refill', async () => {
    const { result } = renderHook(() => useRunFollowUp(run));

    await act(async () => {
      await result.current.submitFollowUp('hello');
    });

    // An inline reply has no composer editor of its own. Without `null` the send
    // lifecycle falls back to ChatStore's global editor — a different surface —
    // and writes this message into it on failure.
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ inputEditor: null }));
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

  it('reports failure and stays closed when the gateway refuses the send', async () => {
    // Regression: a refused start resolves `undefined`, so awaiting the send
    // looked like success — the drawer opened and both callers closed the reply
    // editor, discarding the draft the user had just typed.
    refuseSend();
    const { result } = renderHook(() => useRunFollowUp(run));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.submitFollowUp('please follow up');
    });

    expect(sent).toBe(false);
    expect(mocks.openTopicDrawer).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('taskDetail.followUpFailed');
  });

  it('reports failure when the send throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sendMessage.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useRunFollowUp(run));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.submitFollowUp('please follow up');
    });

    expect(sent).toBe(false);
    expect(mocks.openTopicDrawer).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('taskDetail.followUpFailed');
    consoleError.mockRestore();
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
