import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { messageService } from '@/services/message';
import { useAgentStore } from '@/store/agent';

import { ChatForwardActionImpl } from './action';

const message = (role: UIChatMessage['role'], content: string): UIChatMessage =>
  ({ content, id: `${role}-${content}`, role }) as UIChatMessage;

describe('ChatForwardAction', () => {
  beforeEach(() => {
    useAgentStore.setState({ agentMap: {} });
    vi.spyOn(agentService, 'getAgentConfigById').mockImplementation(
      async (id) => ({ id }) as never,
    );
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards only user and assistant text into isolated topics', async () => {
    const onTopicCreated = vi.fn();
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(async ({ onTopicCreated: notifyTopicCreated }) => {
        notifyTopicCreated('topic-a');
        return { createdTopicId: 'topic-a' };
      })
      .mockRejectedValueOnce(new Error('failed'));
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    const result = await action.forwardMessages({
      header: 'Forwarded',
      messages: [
        message('user', 'question'),
        message('tool', 'private tool output'),
        message('assistant', 'answer'),
      ],
      onTopicCreated,
      roleLabel: (role) => role,
      targets: [{ id: 'agent-a' }, { id: 'agent-b' }],
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(agentService.getAgentConfigById).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0].message).toBe(
      'Forwarded\n\n---\n\n**user**\n\nquestion\n\n---\n\n**assistant**\n\nanswer',
    );
    expect(sendMessage.mock.calls[0][0].message).not.toContain('private tool output');
    expect(onTopicCreated).toHaveBeenCalledWith({ id: 'agent-a' }, 'topic-a');
    expect(result.succeeded).toEqual([{ agentId: 'agent-a', topicId: 'topic-a' }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].agentId).toBe('agent-b');
  });

  it('treats a send without a created topic as a failure', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    const result = await action.forwardMessages({
      header: 'Forwarded',
      messages: [message('user', 'question')],
      roleLabel: (role) => role,
      targets: [{ id: 'agent-a' }],
    });

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });

  it('treats a missing target agent as a failure without sending', async () => {
    vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(null);
    const sendMessage = vi.fn();
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    const result = await action.forwardMessages({
      header: 'Forwarded',
      messages: [message('user', 'question')],
      roleLabel: (role) => role,
      targets: [{ id: 'missing-agent' }],
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].agentId).toBe('missing-agent');
  });

  it('asks the target agent to load the source topic through the LobeHub CLI', async () => {
    vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce({
      agencyConfig: { heterogeneousProvider: { type: 'codex' } },
      id: 'target-agent',
    } as never);
    const onTopicCreated = vi.fn();
    const sendMessage = vi.fn().mockImplementation(async ({ onTopicCreated: notify }) => {
      notify('new-topic');
      return { createdTopicId: 'new-topic' };
    });
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    const result = await action.forwardTopic({
      header: 'Forwarded topic',
      note: 'Finish the review',
      onTopicCreated,
      roleLabel: (role) => role,
      sourceAgentId: 'source-agent',
      targets: [{ id: 'target-agent' }],
      topicId: 'source-topic',
    });

    expect(onTopicCreated).toHaveBeenCalledWith({ id: 'target-agent' }, 'new-topic');
    expect(sendMessage.mock.calls[0][0].message).toContain('lh topic view source-topic -L 500');
    expect(sendMessage.mock.calls[0][0].message).toContain('Finish the review');
    expect(sendMessage.mock.calls[0][0].context).toEqual({
      agentId: 'target-agent',
      isNew: true,
      isolatedTopic: true,
      scope: 'main',
    });
    expect(result.succeeded).toEqual([{ agentId: 'target-agent', topicId: 'new-topic' }]);
    expect(messageService.getMessages).not.toHaveBeenCalled();
  });

  it('keeps transcript context when the target agent cannot use the LobeHub CLI', async () => {
    vi.mocked(messageService.getMessages).mockResolvedValueOnce([
      message('user', 'question'),
      message('assistant', 'answer'),
    ]);
    const sendMessage = vi.fn().mockImplementation(async ({ onTopicCreated: notify }) => {
      notify('new-topic');
      return { createdTopicId: 'new-topic' };
    });
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    await action.forwardTopic({
      header: 'Forwarded topic',
      note: 'Continue carefully',
      roleLabel: (role) => role,
      sourceAgentId: 'source-agent',
      targets: [{ id: 'plain-agent' }],
      topicId: 'source-topic',
    });

    expect(messageService.getMessages).toHaveBeenCalledWith({
      agentId: 'source-agent',
      topicId: 'source-topic',
    });
    expect(sendMessage.mock.calls[0][0].message).toBe(
      'Forwarded topic\n\n---\n\n**user**\n\nquestion\n\n---\n\n**assistant**\n\nanswer\n\nContinue carefully',
    );
    expect(sendMessage.mock.calls[0][0].message).not.toContain('lh topic view');
  });
});
