import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      createMessage: { mutate: vi.fn() },
      getMessages: { query: vi.fn() },
      removeMessagesByAssistant: { mutate: vi.fn() },
    },
  },
}));

describe('MessageService', () => {
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
