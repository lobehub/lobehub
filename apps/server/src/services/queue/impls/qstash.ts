import debug from 'debug';

import { OtelQstashClient } from '@/libs/qstash';

import { type HealthCheckResult, type QueueMessage, type QueueStats } from '../types';
import { type QueueServiceImpl } from './type';

const log = debug('lobe-server:service:queue:qstash');

/**
 * QStash's `delay` option is second-granularity — the `Duration` string form
 * (`10s`, `1m`, `2h`, `1d`) has no millisecond unit, and a bare number is
 * treated as seconds (so `100` would mean 100s, not 100ms). Positive
 * sub-second delays are rounded up to 1s.
 */
const toQStashDelaySeconds = (delayMs: number): number | undefined => {
  if (delayMs <= 0) return undefined;

  return Math.max(1, Math.round(delayMs / 1000));
};

/**
 * QStash queue service implementation
 */
export class QStashQueueServiceImpl implements QueueServiceImpl {
  private config: { publishUrl?: string; qstashToken: string };

  constructor(config: { publishUrl?: string; qstashToken: string }) {
    if (!config.qstashToken) {
      throw new Error('QStash token is required for queue service');
    }

    this.config = config;
  }

  async scheduleMessage(message: QueueMessage): Promise<string> {
    const {
      operationId,
      stepIndex,
      context,
      endpoint,
      payload,
      delay = 50,
      priority = 'normal',
      retryDelay,
      retries = 3,
    } = message;

    try {
      log('Initialized QStash queue service');
      const qstashClient = new OtelQstashClient({ token: this.config.qstashToken });
      const qstashDelay = toQStashDelaySeconds(delay);
      const request = {
        body: {
          context,
          operationId,
          payload,
          priority,
          stepIndex,
          timestamp: Date.now(),
        },
        ...(qstashDelay === undefined ? {} : { delay: qstashDelay }),
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Operation-Id': operationId,
          'X-Agent-Priority': priority,
          'X-Agent-Step-Index': stepIndex.toString(),
        },
        retryDelay,
        retries,
        url: endpoint,
      };
      const response = await qstashClient.publishJSON(request);

      log(
        `[${operationId}] Scheduled step %d to %s with %dms delay (messageId: %s)`,
        stepIndex,
        endpoint,
        delay,
        'messageId' in response ? response.messageId : 'batch-message',
      );

      return 'messageId' in response ? response.messageId : `scheduled-${Date.now()}`;
    } catch (error) {
      log('Failed to schedule step %d for operation %s: %O', stepIndex, operationId, error);
      throw error;
    }
  }

  async scheduleBatchMessages(messages: QueueMessage[]): Promise<string[]> {
    try {
      // Use Promise.all for concurrent execution
      const messageIds = await Promise.all(
        messages.map((message) => this.scheduleMessage(message)),
      );

      log('Scheduled %d batch messages', messages.length);
      return messageIds;
    } catch (error) {
      log('Failed to schedule batch messages: %O', error);
      throw error;
    }
  }

  async cancelScheduledTask(messageId: string): Promise<void> {
    try {
      // QStash currently doesn't support task cancellation, can record to Redis as cancellation marker
      // Check this marker during actual execution
      log('Requested cancellation for message %s', messageId);

      // TODO: Implement cancellation logic, cancellation list can be stored via Redis
      // await this.redis.sadd('cancelled_tasks', messageId);
    } catch (error) {
      log('Failed to cancel task %s: %O', messageId, error);
      throw error;
    }
  }

  async getQueueStats(): Promise<QueueStats> {
    return {
      completedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      processingCount: 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    // Simple health check without sending actual messages
    return {
      healthy: true,
      message: 'QStash queue service is ready',
    };
  }
}
