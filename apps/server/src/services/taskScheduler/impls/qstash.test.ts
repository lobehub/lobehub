// @vitest-environment node
import type { Client } from '@upstash/qstash';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QStashTaskScheduler } from './qstash';

const makeClient = () => {
  const publishJSON = vi.fn();
  const messagesDelete = vi.fn();
  const client = {
    messages: { delete: messagesDelete },
    publishJSON,
  } as unknown as Client;
  return { client, messagesDelete, publishJSON };
};

describe('QStashTaskScheduler', () => {
  let publishJSON: ReturnType<typeof vi.fn>;
  let messagesDelete: ReturnType<typeof vi.fn>;
  let scheduler: QStashTaskScheduler;

  beforeEach(() => {
    const { client, publishJSON: pj, messagesDelete: md } = makeClient();
    publishJSON = pj;
    messagesDelete = md;
    scheduler = new QStashTaskScheduler({
      baseUrl: 'https://app.example.com',
      qstashClient: client,
    });
  });

  describe('scheduleNextTopic', () => {
    it('publishes a delayed message to /heartbeat-tick and returns messageId', async () => {
      publishJSON.mockResolvedValue({ messageId: 'msg-abc' });

      const id = await scheduler.scheduleNextTopic({
        delay: 60,
        taskId: 'task-1',
        userId: 'user-1',
      });

      expect(id).toBe('msg-abc');
      expect(publishJSON).toHaveBeenCalledWith({
        body: { taskId: 'task-1', userId: 'user-1' },
        delay: 60,
        url: 'https://app.example.com/api/workflows/task/heartbeat-tick',
      });
    });

    it('defaults delay to 0 when not provided', async () => {
      publishJSON.mockResolvedValue({ messageId: 'msg-2' });

      await scheduler.scheduleNextTopic({ taskId: 't', userId: 'u' });

      expect(publishJSON).toHaveBeenCalledWith(expect.objectContaining({ delay: 0 }));
    });

    it('strips trailing slash from baseUrl', async () => {
      const { client, publishJSON: pj } = makeClient();
      pj.mockResolvedValue({ messageId: 'm' });
      const sched = new QStashTaskScheduler({
        baseUrl: 'https://app.example.com/',
        qstashClient: client,
      });

      await sched.scheduleNextTopic({ taskId: 't', userId: 'u' });

      expect(pj).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://app.example.com/api/workflows/task/heartbeat-tick',
        }),
      );
    });

    it('returns empty string when response lacks messageId (defensive)', async () => {
      publishJSON.mockResolvedValue({} as any);

      const id = await scheduler.scheduleNextTopic({ taskId: 't', userId: 'u' });

      expect(id).toBe('');
    });
  });

  describe('cancelScheduled', () => {
    it('calls messages.delete with the messageId', async () => {
      messagesDelete.mockResolvedValue(undefined);

      await scheduler.cancelScheduled('msg-xyz');

      expect(messagesDelete).toHaveBeenCalledWith('msg-xyz');
    });

    it('is a no-op for empty messageId', async () => {
      await scheduler.cancelScheduled('');

      expect(messagesDelete).not.toHaveBeenCalled();
    });

    it('swallows errors (already delivered / not found)', async () => {
      messagesDelete.mockRejectedValue(new Error('not found'));

      await expect(scheduler.cancelScheduled('msg-gone')).resolves.toBeUndefined();
    });
  });
});
