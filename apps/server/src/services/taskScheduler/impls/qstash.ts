import type { Client } from '@upstash/qstash';
import debug from 'debug';

import type { ScheduleNextTopicParams, TaskSchedulerImpl } from './type';

const log = debug('task-scheduler:qstash');

const HEARTBEAT_TICK_PATH = '/api/workflows/task/heartbeat-tick';

export interface QStashTaskSchedulerConfig {
  /** Absolute base URL (e.g. `process.env.APP_URL`). Used to build the tick callback URL. */
  baseUrl: string;
  qstashClient: Client;
}

/**
 * QStash-backed task scheduler.
 *
 * Each `scheduleNextTopic` call publishes a one-shot delayed message; QStash will
 * POST `{ taskId, userId }` to `/api/workflows/task/heartbeat-tick` after `delay`
 * seconds. The handler is responsible for re-checking task state (DB is the
 * authority — a tick may arrive after the user paused or canceled the task).
 */
export class QStashTaskScheduler implements TaskSchedulerImpl {
  private baseUrl: string;
  private qstashClient: Client;

  constructor(config: QStashTaskSchedulerConfig) {
    this.qstashClient = config.qstashClient;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async scheduleNextTopic(params: ScheduleNextTopicParams): Promise<string> {
    const { taskId, userId, delay = 0 } = params;
    const url = `${this.baseUrl}${HEARTBEAT_TICK_PATH}`;

    log('Publishing tick: task=%s delay=%ds url=%s', taskId, delay, url);

    const response = await this.qstashClient.publishJSON({
      body: { taskId, userId },
      delay,
      url,
    });

    const messageId = 'messageId' in response ? response.messageId : '';
    log('Published tick messageId=%s', messageId);
    return messageId;
  }

  async cancelScheduled(messageId: string): Promise<void> {
    if (!messageId) return;
    try {
      await this.qstashClient.messages.delete(messageId);
      log('Canceled tick messageId=%s', messageId);
    } catch (error) {
      // Already delivered / not found — silent. The handler does idempotency
      // checks against DB state, so a stale tick will be ignored anyway.
      log('cancelScheduled noop (likely already delivered): %s, %O', messageId, error);
    }
  }
}
