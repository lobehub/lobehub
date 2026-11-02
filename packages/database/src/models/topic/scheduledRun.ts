import {
  type ChatTopicMetadata,
  type ChatTopicStatus,
  parseTopicScheduledRun,
  type TopicScheduledRun,
} from '@lobechat/types';
import { and, eq, or, sql } from 'drizzle-orm';

import { type TopicItem, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import type { TopicModelContext } from './context';

/** Atomically cancel an unclaimed rate-limit run, serialized with the dispatcher. */
export const cancelRateLimitContinuation = async (ctx: TopicModelContext, id: string) =>
  ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ metadata: topics.metadata, status: topics.status })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');
    if (!row) return { status: 'unchanged' as const };
    if (row.status === 'running') return { status: 'busy' as const };
    const scheduledRun = parseTopicScheduledRun(row.metadata?.scheduledRun);
    if (row.status !== 'scheduled' || scheduledRun?.kind !== 'resume_after_rate_limit')
      return { status: 'unchanged' as const };
    // A lease expiring does not stop its dispatcher. Once claimed, a handoff
    // must not race that worker, even if its five-minute lease has elapsed.
    if (scheduledRun.claim) return { status: 'busy' as const };

    const metadata = { ...row.metadata, scheduledRun: null };
    await tx
      .update(topics)
      .set({ metadata, status: 'failed' })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return { metadata, status: 'cancelled' as const };
  });

/**
 * Arm a scheduled run on an owned topic: writes `metadata.scheduledRun` and
 * flips the status to `scheduled` in a single update.
 *
 * The pair is one fact — a topic that is `scheduled` with no payload spins in
 * the dispatcher forever, and a payload on a non-`scheduled` topic never fires
 * — so they must never be written separately. The inverse is
 * {@link TopicModel.clearScheduledRun}.
 */
export const armScheduledRun = async (
  ctx: TopicModelContext,
  id: string,
  scheduledRun: TopicScheduledRun,
): Promise<void> => {
  await ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');

    if (!existing) return;

    await tx
      .update(topics)
      .set({
        metadata: { ...existing.metadata, scheduledRun } as ChatTopicMetadata,
        status: 'scheduled',
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
  });
};

/**
 * Topics with a scheduled run that has come due.
 * System-level sweep (no ownership filter) used by the cron dispatcher.
 *
 * Due = `status = 'scheduled'` AND the run's gate has passed AND there is no
 * live claim (`scheduledRun.claim.expiresAt` is absent, or already expired) —
 * so a topic another replica is mid-dispatch on is skipped.
 *
 * `runAt` is the gate for every {@link TopicScheduledRunKind}: a row carrying a
 * `kind` but no `runAt` is never due, which is what keeps a half-written
 * scheduled topic from being dispatched immediately.
 *
 * The one exception is a row parked by the pre-`kind` version, which has no
 * `runAt` and gated on the rate-limit reset instead. Those are still in the DB
 * on deploy, so this reproduces their old gate rather than stranding them at
 * `scheduled` forever — matching `parseTopicScheduledRun`, which upgrades the
 * payload the dispatcher then reads.
 */
export async function getDueScheduledTopics(
  db: LobeChatDatabase,
  now: Date = new Date(),
): Promise<TopicItem[]> {
  const nowIso = now.toISOString();
  const nowEpochSeconds = Math.floor(now.getTime() / 1000);

  // Every jsonb path below is COALESCE'd to a sentinel rather than null-tested:
  // `#>> … IS NULL` in a WHERE clause takes the production engine down. See the
  // note on the class.
  const runAt = sql`COALESCE(${topics.metadata}#>>'{scheduledRun,runAt}', '')`;

  return db
    .select()
    .from(topics)
    .where(
      and(
        eq(topics.status, 'scheduled'),
        notTrashed(topics.isDeleted),
        or(
          // `''` is the absent-runAt sentinel, and it never satisfies this pair —
          // an absent gate must not read as "due now", which is what keeps a
          // half-written schedule parked.
          and(sql`${runAt} <> ''`, sql`${runAt} <= ${nowIso}`),
          // Legacy (pre-`kind`) payload: no `runAt`, gated on the rate-limit
          // reset, and an absent reset read as "due now" (hence the 0 default).
          and(
            sql`${runAt} = ''`,
            sql`COALESCE(${topics.metadata}#>>'{scheduledRun,reason}', '') = 'rate_limit'`,
            sql`COALESCE((${topics.metadata}#>>'{scheduledRun,rateLimit,resetsAt}')::numeric, 0) <= ${nowEpochSeconds}`,
          ),
        ),
        // No claim, or the lease has expired. `''` (no claim) sorts before every
        // ISO timestamp, so the same comparison covers both.
        sql`COALESCE(${topics.metadata}#>>'{scheduledRun,claim,expiresAt}', '') <= ${nowIso}`,
      ),
    );
}

/**
 * Atomically claim a scheduled topic before dispatch, so two concurrent cron
 * ticks can't trigger the same continuation twice. Serializes on the row with
 * `SELECT … FOR UPDATE` (mirrors {@link updateMetadata}) and only writes the
 * lease if the topic is still `scheduled` and not already claimed by a live
 * lease. Returns `true` when this caller won the claim.
 */
export async function claimScheduledTopic(
  db: LobeChatDatabase,
  id: string,
  claim: { claimedAt: string; expiresAt: string; id: string },
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        metadata: topics.metadata,
        projectId: topics.projectId,
        projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
        status: topics.status,
      })
      .from(topics)
      .where(eq(topics.id, id))
      .for('update');

    if (!row || row.status !== 'scheduled') return false;

    const scheduledRun = row.metadata?.scheduledRun;
    if (!scheduledRun) return false;

    const existingClaim = scheduledRun.claim;
    const claimLive = existingClaim && new Date(existingClaim.expiresAt) > now;
    if (claimLive) return false;

    await tx
      .update(topics)
      .set({
        metadata: {
          ...row.metadata,
          scheduledRun: { ...scheduledRun, claim },
        } as ChatTopicMetadata,
      })
      .where(eq(topics.id, id));

    return true;
  });
}

/**
 * Clear the scheduled continuation and restore a normal status. Used both when
 * a continuation is successfully dispatched/executed and when it is cancelled.
 */
export async function clearScheduledRun(
  db: LobeChatDatabase,
  id: string,
  nextStatus: ChatTopicStatus = 'active',
  expectedClaimId?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        metadata: topics.metadata,
        projectId: topics.projectId,
        projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
        status: topics.status,
      })
      .from(topics)
      .where(eq(topics.id, id))
      .for('update');
    if (!row || row.status !== 'scheduled') return;
    if (expectedClaimId && row.metadata?.scheduledRun?.claim?.id !== expectedClaimId) return;

    const nextMetadata = { ...row.metadata, scheduledRun: null } as ChatTopicMetadata;
    await tx
      .update(topics)
      .set({ metadata: nextMetadata, status: nextStatus })
      .where(eq(topics.id, id));
  });
}

/**
 * Re-point a still-pending scheduled run at a new failed-attempt message. A
 * dispatch that fails inside execAgent leaves its own error bubble on the
 * placeholder it created; tracking that bubble as the run's
 * `failedAssistantMessageId` lets the next tick's pre-dispatch cleanup clear
 * it the same way it clears the original card, so retries don't strand one
 * stale error bubble per failed attempt.
 *
 * `expectedClaimId` fences stale writers the same way it does in
 * {@link TopicModel.clearScheduledRun}: a dispatch attempt that outlived its
 * claim lease — or one whose schedule the user cancelled and re-armed — must
 * not overwrite the pointer of a NEWER scheduled run, or the next cleanup
 * would delete / anchor against an unrelated message. No-ops when the
 * schedule was cleared or the claim no longer matches.
 */
export async function repointScheduledRunFailedMessage(
  db: LobeChatDatabase,
  id: string,
  failedAssistantMessageId: string,
  expectedClaimId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        metadata: topics.metadata,
        projectId: topics.projectId,
        projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
        status: topics.status,
      })
      .from(topics)
      .where(eq(topics.id, id))
      .for('update');
    if (!row || row.status !== 'scheduled') return;

    const scheduledRun = row.metadata?.scheduledRun;
    if (!scheduledRun) return;
    if (scheduledRun.claim?.id !== expectedClaimId) return;

    await tx
      .update(topics)
      .set({
        metadata: {
          ...row.metadata,
          scheduledRun: {
            ...scheduledRun,
            failedAssistantMessageId,
            updatedAt: new Date().toISOString(),
          },
        } as ChatTopicMetadata,
      })
      .where(eq(topics.id, id));
  });
}
