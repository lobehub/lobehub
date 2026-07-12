import { randomUUID } from 'node:crypto';

import { HETERO_CONTINUE_PROMPT } from '@lobechat/const';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import type { Context } from 'hono';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { getServerDB } from '@/database/server';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:workflows:task:scheduled-topic-dispatch');

/** How long a claim lease is held before another tick may re-claim the topic. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface ScheduledTopicDispatchPayload {
  /** When true, only report which topics are due without claiming/dispatching. */
  dryRun?: boolean;
}

/**
 * Cron-style dispatcher for pure-topic continuations scheduled after a rate
 * limit. Registered as a QStash Schedule (e.g. `*\/10 * * * *`) pointing at this
 * endpoint. On each tick:
 *
 *   1. Loads topics with `status = 'scheduled'` whose rate-limit window has
 *      passed and that aren't under a live claim.
 *   2. Atomically claims each (a lease on `metadata.scheduledRun.claim`) so two
 *      ticks / replicas never trigger the same continuation twice.
 *   3. Re-runs the turn via `AiAgentService.execAgent` in resume mode — the same
 *      execution engine as a normal agent run, which already routes remote runs
 *      to the topic's bound device via the device gateway.
 *
 * This intentionally does NOT enter TaskLifecycle — a pure topic just re-runs its
 * agent. On success the scheduled state is cleared; on failure (e.g. the device
 * is offline) the topic stays `scheduled` and the claim lease expires so the next
 * tick retries — the scheduled state is never lost.
 *
 * Signature verification is handled by the `qstashAuth` middleware on the route.
 */
export async function scheduledTopicDispatch(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as ScheduledTopicDispatchPayload;
    const { dryRun = false } = body ?? {};

    const db = await getServerDB();
    const now = new Date();
    const due = await TopicModel.getDueScheduledTopics(db, now);

    log('scan: due=%d dryRun=%s', due.length, dryRun);

    if (dryRun || due.length === 0) {
      return c.json({ claimed: 0, dispatched: 0, dryRun, due: due.length, success: true });
    }

    let claimed = 0;
    let dispatched = 0;
    for (const topic of due) {
      const scheduledRun = topic.metadata?.scheduledRun;
      if (!scheduledRun?.userMessageId) continue;

      const claim = {
        claimedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CLAIM_LEASE_MS).toISOString(),
        id: randomUUID(),
      };

      const won = await TopicModel.claimScheduledTopic(db, topic.id, claim, now).catch((err) => {
        console.error('[scheduled-topic-dispatch] claim failed topic=%s: %O', topic.id, err);
        return false;
      });
      if (!won) continue;
      claimed += 1;

      const workspaceId = topic.workspaceId ?? undefined;
      try {
        const messageModel = new MessageModel(db, topic.userId, workspaceId);
        const failedMessage = await messageModel.findById(scheduledRun.failedAssistantMessageId);
        if (!failedMessage) throw new Error('Scheduled continuation message no longer exists');

        // Match continueHeteroAfterError: resume the surviving CLI session from
        // the assistant-chain tail with the shared continuation instruction.
        // Do not delete the failed turn before dispatch; a dispatch failure must
        // leave the user's error card and retry entry intact.
        const result = await new AiAgentService(db, topic.userId, { workspaceId }).execAgent({
          agentId: topic.agentId ?? undefined,
          appContext: { topicId: topic.id },
          parentMessageId: failedMessage.id,
          prompt: HETERO_CONTINUE_PROMPT,
          resume: true,
          trigger: RequestTrigger.Cron,
        });
        if (!result.success) {
          throw new Error(
            result.error || result.message || 'Scheduled continuation dispatch failed',
          );
        }

        // Success — execAgent now owns the run; clear the scheduled state.
        await TopicModel.clearScheduledRun(db, topic.id, 'running', claim.id);
        dispatched += 1;
        log('dispatched topic=%s device=%s', topic.id, topic.metadata?.boundDeviceId);
      } catch (err) {
        // Leave the topic `scheduled` (e.g. device offline). The claim lease
        // expires and the next tick retries — scheduled state is never lost.
        console.error('[scheduled-topic-dispatch] dispatch failed topic=%s: %O', topic.id, err);
      }
    }

    return c.json({ claimed, dispatched, due: due.length, success: true });
  } catch (error) {
    console.error('[task/scheduled-topic-dispatch] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
