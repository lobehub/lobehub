import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      createMessage: { mutate: vi.fn() },
      getMessages: { query: vi.fn() },
      removeMessagesByAssistant: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

describe('MessageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMessages', () => {
    const service = new MessageService();

    it('passes read parameters through without applying client cache policy', async () => {
      vi.mocked(lambdaClient.message.getMessages.query).mockResolvedValue([]);
      const params = {
        agentId: 'agent-1',
        topicId: 'topic-1',
      };

      await service.getMessages(params);

      // The service opts in to file-type works; everything else passes through untouched.
      expect(lambdaClient.message.getMessages.query).toHaveBeenCalledWith({
        ...params,
        includeFileWorks: true,
      });
    });

    it('keeps independent service reads available to strong-consistency callers', async () => {
      vi.mocked(lambdaClient.message.getMessages.query).mockResolvedValue([]);
      const context = { agentId: 'agent-1', topicId: 'topic-1' };

      await Promise.all([service.getMessages(context), service.getMessages(context)]);

      expect(lambdaClient.message.getMessages.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('createMessage', () => {
    const service = new MessageService();

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should pass params directly to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.createMessage.mutate).mockResolvedValue({
        id: 'msg-1',
        messages: [],
      });

      await service.createMessage({
        content: 'test',
        role: 'user',
        agentId: 'agent-123',
      });

      expect(lambdaClient.message.createMessage.mutate).toHaveBeenCalledWith({
        content: 'test',
        role: 'user',
        agentId: 'agent-123',
      });
    });
  });

  describe('updateMessage', () => {
    const service = new MessageService();

    it('normalizes provider errors without a valid type before persistence', async () => {
      vi.mocked(lambdaClient.message.update.mutate).mockResolvedValue({ success: true } as any);

      await service.updateMessage(
        'msg-1',
        {
          error: {
            body: { code: 'Arrearage' },
            message: 'Access denied because the account is in arrears',
            type: undefined,
          } as any,
        },
        { agentId: 'agent-1', topicId: 'topic-1' },
      );

      expect(lambdaClient.message.update.mutate).toHaveBeenCalledWith({
        agentId: 'agent-1',
        id: 'msg-1',
        topicId: 'topic-1',
        value: {
          error: {
            body: { code: 'Arrearage' },
            message: 'Access denied because the account is in arrears',
            type: 'ApplicationRuntimeError',
          },
        },
      });
    });

    it.each([undefined, null, {}, Number.NaN, Number.POSITIVE_INFINITY])(
      'falls back when the persisted error type is invalid: %s',
      async (type) => {
        vi.mocked(lambdaClient.message.update.mutate).mockResolvedValue({ success: true } as any);

        await service.updateMessage('msg-1', {
          error: { message: 'provider failed', type } as any,
        });

        expect(lambdaClient.message.update.mutate).toHaveBeenLastCalledWith(
          expect.objectContaining({
            value: {
              error: expect.objectContaining({ type: 'ApplicationRuntimeError' }),
            },
          }),
        );
      },
    );

    it('preserves a valid type even when errorType is also present', async () => {
      vi.mocked(lambdaClient.message.update.mutate).mockResolvedValue({ success: true } as any);

      await service.updateMessage('msg-1', {
        error: {
          errorType: 'ProviderBizError',
          message: 'rate limited',
          type: 'RateLimitExceeded',
        } as any,
      });

      expect(lambdaClient.message.update.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          value: {
            error: expect.objectContaining({ type: 'RateLimitExceeded' }),
          },
        }),
      );
    });
  });

  describe('updateMessageError', () => {
    it('normalizes an invalid error type through the dedicated error update path', async () => {
      vi.mocked(lambdaClient.message.update.mutate).mockResolvedValue({ success: true } as any);

      await new MessageService().updateMessageError('msg-1', {
        message: 'provider failed',
        type: Number.NaN,
      } as any);

      expect(lambdaClient.message.update.mutate).toHaveBeenLastCalledWith({
        id: 'msg-1',
        value: {
          error: expect.objectContaining({ type: 'ApplicationRuntimeError' }),
        },
      });
    });
  });

  describe('removeMessagesByAssistant', () => {
    const service = new MessageService();

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should pass sessionId to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.removeMessagesByAssistant.mutate).mockResolvedValue(
        undefined as any,
      );

      await service.removeMessagesByAssistant('session-123');

      expect(lambdaClient.message.removeMessagesByAssistant.mutate).toHaveBeenCalledWith({
        sessionId: 'session-123',
        topicId: undefined,
      });
    });

    it('should pass sessionId and topicId to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.removeMessagesByAssistant.mutate).mockResolvedValue(
        undefined as any,
      );

      await service.removeMessagesByAssistant('session-123', 'topic-1');

      expect(lambdaClient.message.removeMessagesByAssistant.mutate).toHaveBeenCalledWith({
        sessionId: 'session-123',
        topicId: 'topic-1',
      });
    });
  });
});
