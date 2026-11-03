import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from '../index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      batchMutate: {
        mutate: vi.fn(),
      },
      updateMetadata: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('MessageService - Race Condition Control', () => {
  let messageService: MessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = new MessageService();
  });

  describe('batch tool message update race condition', () => {
    it('should cancel a stale batch update for the same tool message', async () => {
      let firstRequestAborted = false;

      vi.mocked(lambdaClient.message.batchMutate.mutate)
        .mockImplementationOnce(
          (_params, options) =>
            new Promise((resolve, reject) => {
              options?.signal?.addEventListener('abort', () => {
                firstRequestAborted = true;
                reject(new Error('Aborted'));
              });
            }),
        )
        .mockResolvedValueOnce({
          results: [{ id: 'tool-1', index: 0, success: true, type: 'updateToolMessage' }],
          success: true,
        });

      const firstPromise = messageService.batchMutateOrThrow([
        {
          id: 'tool-1',
          type: 'updateToolMessage',
          value: { content: 'stale result' },
        },
      ]);
      const secondPromise = messageService.batchMutateOrThrow([
        {
          id: 'tool-1',
          type: 'updateToolMessage',
          value: { content: 'latest result' },
        },
      ]);

      await expect(firstPromise).rejects.toThrow('Aborted');
      await expect(secondPromise).resolves.toMatchObject({ success: true });
      expect(firstRequestAborted).toBe(true);
      expect(lambdaClient.message.batchMutate.mutate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          operations: [
            expect.objectContaining({
              id: 'tool-1',
              value: { content: 'latest result' },
            }),
          ],
        }),
        { signal: expect.any(AbortSignal) },
      );
    });
  });

  describe('updateMessageMetadata race condition', () => {
    it('should cancel previous request when new update is triggered for same message', async () => {
      const messageId = 'test-message-id';
      let firstRequestAborted = false;
      let secondRequestCompleted = false;

      // Mock first request (slow)
      vi.mocked(lambdaClient.message.updateMetadata.mutate).mockImplementationOnce(
        (_params, options) =>
          new Promise((resolve, reject) => {
            const signal = options?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                firstRequestAborted = true;
                reject(new Error('Aborted'));
              });
            }
            // Simulate slow request
            setTimeout(() => resolve({ success: true, messages: [] }), 200);
          }),
      );

      // Mock second request (fast)
      vi.mocked(lambdaClient.message.updateMetadata.mutate).mockImplementationOnce(
        async (_params, _options) => {
          secondRequestCompleted = true;
          return { success: true, messages: [] };
        },
      );

      // Start first update
      const firstPromise = messageService.updateMessageMetadata(messageId, { compare: true });

      // Wait a bit then start second update
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondPromise = messageService.updateMessageMetadata(messageId, { compare: false });

      // First should be aborted
      await expect(firstPromise).rejects.toThrow('Aborted');
      expect(firstRequestAborted).toBe(true);

      // Second should complete successfully
      await expect(secondPromise).resolves.toEqual({ success: true, messages: [] });
      expect(secondRequestCompleted).toBe(true);
    });

    it('should allow concurrent updates for different messages', async () => {
      const message1Id = 'message-1';
      const message2Id = 'message-2';

      vi.mocked(lambdaClient.message.updateMetadata.mutate).mockResolvedValue({
        success: true,
        messages: [],
      });

      const [result1, result2] = await Promise.all([
        messageService.updateMessageMetadata(message1Id, { cost: 0.001 }),
        messageService.updateMessageMetadata(message2Id, { cost: 0.002 }),
      ]);

      expect(result1).toEqual({ success: true, messages: [] });
      expect(result2).toEqual({ success: true, messages: [] });
      expect(lambdaClient.message.updateMetadata.mutate).toHaveBeenCalledTimes(2);
    });

    it('should handle rapid successive updates correctly', async () => {
      const messageId = 'test-message-id';
      let completedUpdates = 0;
      const abortedUpdates: number[] = [];

      // All but the last request should be aborted
      let callIndex = 0;
      vi.mocked(lambdaClient.message.updateMetadata.mutate).mockImplementation(
        (_params, options) => {
          const currentIndex = callIndex++;
          return new Promise((resolve, reject) => {
            const signal = options?.signal;
            let isAborted = false;

            if (signal) {
              signal.addEventListener('abort', () => {
                isAborted = true;
                abortedUpdates.push(currentIndex);
                reject(new Error('Aborted'));
              });
            }

            setTimeout(() => {
              if (!isAborted) {
                completedUpdates++;
                resolve({ success: true, messages: [] });
              }
            }, 50);
          });
        },
      );

      // Trigger 5 rapid updates sequentially with catch to prevent unhandled rejections
      const promise1 = messageService
        .updateMessageMetadata(messageId, { cost: 0.001 })
        .catch((e) => e);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const promise2 = messageService
        .updateMessageMetadata(messageId, { cost: 0.002 })
        .catch((e) => e);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const promise3 = messageService.updateMessageMetadata(messageId, { tps: 10 }).catch((e) => e);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const promise4 = messageService.updateMessageMetadata(messageId, { tps: 20 }).catch((e) => e);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const promise5 = messageService
        .updateMessageMetadata(messageId, { compare: true })
        .catch((e) => e);

      // Wait for all to settle
      const results = await Promise.all([promise1, promise2, promise3, promise4, promise5]);

      // First 4 should be errors (aborted), last should succeed
      expect(results[0]).toBeInstanceOf(Error);
      expect(results[1]).toBeInstanceOf(Error);
      expect(results[2]).toBeInstanceOf(Error);
      expect(results[3]).toBeInstanceOf(Error);
      expect(results[4]).toEqual({ success: true, messages: [] });

      // 4 requests should have been aborted
      expect(abortedUpdates.length).toBe(4);
      expect(abortedUpdates).toEqual([0, 1, 2, 3]);

      // Only the last request should complete
      expect(completedUpdates).toBe(1);
    });
  });
});
