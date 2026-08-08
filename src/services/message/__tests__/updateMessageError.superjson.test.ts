import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService, toPlainChatMessageError } from '../index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      update: { mutate: vi.fn().mockResolvedValue({ messages: [], success: true }) },
    },
  },
}));

describe('toPlainChatMessageError', () => {
  it('preserves type from an Error that had ChatMessageError fields assigned', () => {
    const streamError = new Error('Invalid API Key');
    Object.assign(streamError, {
      body: { provider: 'openai' },
      type: 'InvalidProviderAPIKey',
    });

    expect(toPlainChatMessageError(streamError as any)).toEqual({
      body: { provider: 'openai' },
      message: 'Invalid API Key',
      type: 'InvalidProviderAPIKey',
    });
  });

  it('maps errorType when type is absent', () => {
    expect(
      toPlainChatMessageError({ error: undefined, errorType: 'InvalidProviderAPIKey' } as any),
    ).toEqual({
      body: undefined,
      message: undefined,
      type: 'InvalidProviderAPIKey',
    });
  });
});

describe('MessageService.updateMessageError + superjson', () => {
  const service = new MessageService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a plain ChatMessageError that survives superjson (Error custom fields do not)', async () => {
    const streamError = new Error('Invalid API Key');
    Object.assign(streamError, {
      body: { provider: 'openai' },
      errorType: 'InvalidProviderAPIKey',
      type: 'InvalidProviderAPIKey',
    });

    // Superjson drops custom fields on Error — this is why we must plain-clone.
    const stripped = superjson.deserialize(superjson.serialize(streamError)) as Error;
    expect((stripped as any).type).toBeUndefined();

    await service.updateMessageError('msg-1', streamError as any, { topicId: 'topic-1' });

    expect(lambdaClient.message.update.mutate).toHaveBeenCalledWith({
      id: 'msg-1',
      topicId: 'topic-1',
      value: {
        error: {
          body: { provider: 'openai' },
          message: 'Invalid API Key',
          type: 'InvalidProviderAPIKey',
        },
      },
    });

    const payload = vi.mocked(lambdaClient.message.update.mutate).mock.calls[0][0];
    const roundTripped = superjson.deserialize(superjson.serialize(payload)) as typeof payload;
    expect(roundTripped.value.error.type).toBe('InvalidProviderAPIKey');
  });

  it('normalizes error on updateMessage so optimistic paths stay safe', async () => {
    const streamError = new Error('boom');
    Object.assign(streamError, { type: 'InvalidProviderAPIKey' });

    await service.updateMessage('msg-3', { error: streamError as any });

    expect(lambdaClient.message.update.mutate).toHaveBeenCalledWith({
      id: 'msg-3',
      value: {
        error: {
          body: { message: 'boom', name: 'Error' },
          message: 'boom',
          type: 'InvalidProviderAPIKey',
        },
      },
    });
  });
});
