import { randomUUID } from 'node:crypto';

import { parseTopicScheduledRun } from '@lobechat/types';
import debug from 'debug';
import type { Context } from 'hono';

import { TopicModel } from '@/database/models/topic';
import { getServerDB } from '@/database/server';

import { dispatchScheduledRun } from './scheduledRunKinds';

const log = debug('lobe-server:workflows:task:scheduled-topic-dispatch');

/** How long a claim lease is held before another tick may re-claim the topic. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface ScheduledTopicDispatchPayload {
  /** When true, only report which topics are due without claiming/dispatching. */
  dryRun?: boolean;
}

/**
 * Cron-style dispatcher for deferred runs on pure (non-Task) topics. Registered
 * as a QStash Schedule (e.g. `*\/10 * * * *`) pointing at this endpoint. On each
 * tick:
 *
 *   1. Loads topics with `status = 'scheduled'` whose `scheduledRun.runAt` has
 *      passed and that aren't under a live claim.
 *   2. Atomically claims each (a lease on `metadata.scheduledRun.claim`) so two
 *      ticks / replicas never dispatch the same run twice.
 *   3. Hands the run to its kind handler, which re-enters
 *      `AiAgentService.execAgent` — the same execution engine as a normal agent
 *      run, which already routes remote runs to the topic's bound device via the
 *      device gateway.
 *
 * Everything here is kind-agnostic: scanning, the lease and clearing state are
 * shared, and a {@link dispatchScheduledRun} handler decides only *what* to run.
 *
 * This intentionally does NOT enter TaskLifecycle — a pure topic just runs its
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
    let discarded = 0;
    for (const topic of due) {
      // Reads the current payload and the pre-`kind` legacy one alike — the due
      // query selects both, so this must dispatch both.
      const run = parseTopicScheduledRun(topic.metadata?.scheduledRun);
      if (!run) {
        // A due topic whose payload we can't dispatch would re-surface on every
        // tick forever, so drop the schedule instead of skipping it. Back to
        // `active`: the topic itself is intact, only the schedule is unusable.
        console.error(
          '[scheduled-topic-dispatch] discarding unparseable scheduledRun topic=%s: %O',
          topic.id,
          topic.metadata?.scheduledRun,
        );
        await TopicModel.clearScheduledRun(db, topic.id, 'active').catch(() => undefined);
        discarded += 1;
        continue;
      }

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
        const result = await dispatchScheduledRun(run, {
          claimId: claim.id,
          db,
          topic,
          workspaceId,
        });
        if (!result.success) {
          throw new Error(result.error || result.message || 'Scheduled run dispatch failed');
        }

        // Success — execAgent now owns the run; clear the scheduled state.
        await TopicModel.clearScheduledRun(db, topic.id, 'running', claim.id);
        dispatched += 1;
        log(
          'dispatched topic=%s kind=%s device=%s',
          topic.id,
          run.kind,
          topic.metadata?.boundDeviceId,
        );
      } catch (err) {
        // Leave the topic `scheduled` (e.g. device offline). The claim lease
        // expires and the next tick retries — scheduled state is never lost.
        console.error('[scheduled-topic-dispatch] dispatch failed topic=%s: %O', topic.id, err);
      }
    }

    return c.json({ claimed, discarded, dispatched, due: due.length, success: true });
  } catch (error) {
    console.error('[task/scheduled-topic-dispatch] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
