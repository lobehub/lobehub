import type { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';

import { ChatForwardActionImpl } from './action';

const message = (role: UIChatMessage['role'], content: string): UIChatMessage =>
  ({ content, id: `${role}-${content}`, role }) as UIChatMessage;

describe('ChatForwardAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards only user and assistant text into isolated topics', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ createdTopicId: 'topic-a' })
      .mockRejectedValueOnce(new Error('failed'));
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    const result = await action.forwardMessages({
      header: 'Forwarded',
      messages: [
        message('user', 'question'),
        message('tool', 'private tool output'),
        message('assistant', 'answer'),
      ],
      roleLabel: (role) => role,
      targets: [{ id: 'agent-a' }, { id: 'agent-b' }],
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0].message).toBe(
      'Forwarded\n\n---\n\n**user**\n\nquestion\n\n---\n\n**assistant**\n\nanswer',
    );
    expect(sendMessage.mock.calls[0][0].message).not.toContain('private tool output');
    expect(result.succeeded).toEqual([{ agentId: 'agent-a', topicId: 'topic-a' }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].agentId).toBe('agent-b');
  });

  it('loads topic messages before forwarding them', async () => {
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([message('user', 'from topic')]);
    const sendMessage = vi.fn().mockResolvedValue({ createdTopicId: 'new-topic' });
    const action = new ChatForwardActionImpl(vi.fn() as never, () => ({ sendMessage }) as never);

    const result = await action.forwardTopic({
      header: 'Forwarded topic',
      roleLabel: (role) => role,
      sourceAgentId: 'source-agent',
      targets: [{ id: 'target-agent' }],
      topicId: 'source-topic',
    });

    expect(messageService.getMessages).toHaveBeenCalledWith({
      agentId: 'source-agent',
      topicId: 'source-topic',
    });
    expect(result.succeeded).toEqual([{ agentId: 'target-agent', topicId: 'new-topic' }]);
  });
});
