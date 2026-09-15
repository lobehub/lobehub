// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDocumentRewriteQueueMessage,
  LocalDocumentRewriteQueue,
  parseDocumentRewriteQueueMessage,
  QueueServiceDocumentRewriteQueue,
} from './queue';

describe('document rewrite queue contract', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts only requestId + positive attempt and rejects payload smuggling', () => {
    expect(createDocumentRewriteQueueMessage('request-1', 2)).toEqual({
      attempt: 2,
      requestId: 'request-1',
    });
    expect(
      parseDocumentRewriteQueueMessage({ attempt: 1, requestId: 'request-1', ticket: 'x' }),
    ).toBe(null);
    expect(parseDocumentRewriteQueueMessage({ attempt: '1', requestId: 'request-1' })).toBe(null);
    expect(parseDocumentRewriteQueueMessage({ attempt: 0, requestId: 'request-1' })).toBe(null);
  });

  it('deduplicates pending local deliveries and invokes the handler asynchronously', async () => {
    vi.useFakeTimers();
    const handled: Array<{ attempt: number; requestId: string }> = [];
    const queue = new LocalDocumentRewriteQueue({
      handler: (message) => handled.push(message),
    });

    const first = await queue.enqueue({ attempt: 1, requestId: 'request-1' });
    const duplicate = await queue.enqueue({ attempt: 1, requestId: 'request-1' });
    expect(first).toBe(duplicate);
    expect(queue.getPendingCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(0);
    expect(handled).toEqual([{ attempt: 1, requestId: 'request-1' }]);
    expect(queue.getPendingCount()).toBe(0);
    queue.close();
  });

  it('wraps the existing QueueService without placing secrets or document content in payload', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('message-1');
    const queue = new QueueServiceDocumentRewriteQueue({
      endpoint: 'https://example.test/api/agent/document-rewrite',
      queueService: { scheduleMessage },
    });

    await queue.enqueue({ attempt: 3, requestId: 'request-1' }, { delayMs: 1250 });
    expect(scheduleMessage).toHaveBeenCalledWith({
      delay: 1250,
      endpoint: 'https://example.test/api/agent/document-rewrite',
      operationId: 'document-rewrite:request-1',
      payload: { attempt: 3, requestId: 'request-1' },
      priority: 'normal',
      retries: 3,
      retryDelay: undefined,
      stepIndex: 3,
    });
  });
});
