import debug from 'debug';

import { OtelQstashClient } from '@/libs/qstash';

import { type HealthCheckResult, type QueueMessage, type QueueStats } from '../types';
import { type QueueServiceImpl } from './type';

const log = debug('lobe-server:service:queue:qstash');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toQStashDelaySeconds = (delayMs: number): number | undefined => {
  if (delayMs <= 0) return undefined;
  if (delayMs < 1000) return undefined;

  return Math.round(delayMs / 1000);
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
      // QStash publish delays are second-granularity (`10s`, `1m`, or numeric
      // seconds). Preserve the runtime's small settling windows, such as the
      // initial 50ms, by waiting before publishing instead of collapsing them to
      // immediate delivery.
      if (delay > 0 && delay < 1000) {
        await sleep(delay);
      }

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
