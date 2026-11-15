import type { Client } from '@upstash/qstash';
import debug from 'debug';

import type { GoalSchedulerImpl, ScheduleGoalAdvanceParams } from './type';

const log = debug('goal-scheduler:qstash');

export const GOAL_ADVANCE_PATH = '/api/workflows/goal/advance';

/** Polls of one goal aimed within this window are the same re-check. */
const POLL_WINDOW_MS = 5000;

export interface QStashGoalSchedulerConfig {
  /** Absolute base URL (e.g. `process.env.APP_URL`) used to build the callback URL. */
  baseUrl: string;
  qstashClient: Client;
}

/**
 * QStash-backed goal scheduler.
 *
 * Publishes a one-shot message; QStash POSTs `{ goalId, userId, workspaceId }`
 * to `/api/workflows/goal/advance`. The handler re-reads the goal, so a message
 * that arrives after the user paused or the goal finished is a no-op — the
 * database is the authority, never the message.
 */
export class QStashGoalScheduler implements GoalSchedulerImpl {
  private baseUrl: string;
  private qstashClient: Client;

  constructor(config: QStashGoalSchedulerConfig) {
    this.qstashClient = config.qstashClient;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async scheduleAdvance(params: ScheduleGoalAdvanceParams): Promise<string> {
    const { delay = 0, goalId, poll, trigger, userId, workspaceId } = params;
    const url = `${this.baseUrl}${GOAL_ADVANCE_PATH}`;

    // Every advance that ends in a poll books the next one, so without this each
    // extra message (a sweep, a retry) starts a chain that never merges back. The
    // id is the target time: chains collapse, and a chain's own next poll, aimed
    // later, still goes through. Only polls: a wait timer sharing the window would
    // be dropped, and `rearm` will not book it again before its deadline.
    const deduplicationId = poll
      ? `goal-advance-${goalId}-${Math.floor((Date.now() + delay * 1000) / POLL_WINDOW_MS)}`
      : undefined;

    log('publishing advance: goal=%s delay=%ds url=%s', goalId, delay, url);
    const response = await this.qstashClient.publishJSON({
      body: { goalId, trigger, userId, workspaceId },
      delay,
      url,
      ...(deduplicationId ? { deduplicationId } : {}),
    });

    return 'messageId' in response ? response.messageId : '';
  }
}
