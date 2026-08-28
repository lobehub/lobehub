import type { CreateMessageParams } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { MessageModel } from '@/database/models/message';

import { ServerMessageTransport } from './ServerMessageTransport';

const params: CreateMessageParams = {
  agentId: 'agent-1',
  content: '',
  parentId: 'parent-1',
  role: 'assistant',
  topicId: 'topic-1',
};

const createUniqueViolation = (constraint: string) => {
  const error = new Error('Failed query: insert into messages');
  error.cause = {
    code: '23505',
    constraint,
    message: 'duplicate key',
    severity: 'ERROR',
  };
  return error;
};

describe('ServerMessageTransport', () => {
  it('returns the first assistant message when the same idempotency key is delivered twice', async () => {
    const existingMessage = {
      agentId: 'agent-1',
      id: 'assistant-1',
      parentId: 'parent-1',
      role: 'assistant',
      topicId: 'topic-1',
    };
    const messageModel = {
      create: vi
        .fn()
        .mockResolvedValueOnce(existingMessage)
        .mockRejectedValueOnce(createUniqueViolation('message_client_id_user_unique')),
      findByClientId: vi.fn().mockResolvedValue(existingMessage),
    } as unknown as MessageModel;
    const transport = new ServerMessageTransport(messageModel);
    const options = { idempotencyKey: 'agent-runtime:op-1:step:6:assistant' };

    const [first, retried] = await Promise.all([
      transport.createAssistantMessage(params, options),
      transport.createAssistantMessage(params, options),
    ]);

    expect(first.id).toBe('assistant-1');
    expect(retried.id).toBe('assistant-1');
    expect(messageModel.create).toHaveBeenCalledTimes(2);
    expect(messageModel.create).toHaveBeenNthCalledWith(1, {
      ...params,
      clientId: options.idempotencyKey,
    });
    expect(messageModel.create).toHaveBeenNthCalledWith(2, {
      ...params,
      clientId: options.idempotencyKey,
    });
    expect(messageModel.findByClientId).toHaveBeenCalledWith(options.idempotencyKey);
  });

  it('does not swallow an unrelated unique constraint violation', async () => {
    const error = createUniqueViolation('messages_pkey');
    const messageModel = {
      create: vi.fn().mockRejectedValue(error),
      findByClientId: vi.fn(),
    } as unknown as MessageModel;
    const transport = new ServerMessageTransport(messageModel);

    await expect(
      transport.createAssistantMessage(params, {
        idempotencyKey: 'agent-runtime:op-1:step:6:assistant',
      }),
    ).rejects.toBe(error);
    expect(messageModel.findByClientId).not.toHaveBeenCalled();
  });
});
