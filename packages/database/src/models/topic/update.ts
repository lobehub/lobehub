import type { ChatTopicMetadata } from '@lobechat/types';
import { and, eq, or, sql } from 'drizzle-orm';

import { type TopicItem, topics } from '../../schemas';
import { joinTopicAgentsToProjects } from '../../utils/projectTopicAgents';
import { recomputeTopicUsage } from '../topicUsage';
import type { TopicModelContext } from './context';
import type { TopicMetadataPatch } from './types';

export const update = async (ctx: TopicModelContext, id: string, data: Partial<TopicItem>) => {
  /**
   * Older clients switch models through the general update endpoint. Clear
   * the old model's reasoning pin in the same statement, comparing against
   * the persisted row so partial writes and concurrent switches stay safe.
   * Explicit metadata remains the caller's replacement snapshot.
   */
  const modelChanged = or(
    data.model !== undefined ? sql`${topics.model} is distinct from ${data.model}` : undefined,
    data.provider !== undefined
      ? sql`${topics.provider} is distinct from ${data.provider}`
      : undefined,
  );
  const persistedMetadata = modelChanged
    ? sql`case when ${modelChanged} then coalesce(${topics.metadata}, '{}'::jsonb) - 'reasoningConfig' else coalesce(${topics.metadata}, '{}'::jsonb) end`
    : sql`coalesce(${topics.metadata}, '{}'::jsonb)`;

  /**
   * A locally executed run — desktop heterogeneous CLI, in-browser runtime —
   * has no `agent_operations` row: its runtime lives in the client, and the
   * only thing it tells the server is this status write. Stamp when the run
   * claimed the topic in the same statement, so a list can show a live
   * elapsed clock for those runs the same way it does for server-side ones
   * (see `runStartedAtColumn` in {@link TopicModel.queryTopics}).
   *
   * Compared against the PERSISTED status so a resume out of
   * `waitingForHuman` — the same run, continuing after an approval — keeps
   * its original start instead of restarting the clock. The stamp is left
   * behind on terminal statuses: every reader gates on `status = 'running'`,
   * and the next run overwrites it.
   */
  const metadata =
    data.metadata !== undefined
      ? data.metadata
      : data.status === 'running'
        ? sql`case when ${topics.status} in ('running', 'waitingForHuman') then ${persistedMetadata} else jsonb_set(${persistedMetadata}, '{runStartedAt}', to_jsonb(now())) end`
        : modelChanged
          ? persistedMetadata
          : undefined;

  const updated = await ctx.db
    .update(topics)
    .set({ ...data, metadata, updatedAt: new Date() })
    .where(and(eq(topics.id, id), ctx.ownership()))
    .returning();

  // Moving a topic into a project, or handing it to another agent, makes that
  // agent a project member.
  if ((data.projectId || data.agentId) && updated.some((topic) => topic.projectId && topic.agentId))
    await joinTopicAgentsToProjects(ctx.db, { topicIds: updated.map((topic) => topic.id) });

  return updated;
};

/**
 * Settle a topic out of `running` once its run has terminated server-side.
 *
 * Guarded on `status = 'running'` so it is race-tolerant with clients: an
 * attached renderer writes 'active' (focused) or 'unread' (backgrounded) on
 * the terminal stream event, and whichever write lands first wins — this one
 * degrades to a no-op instead of clobbering it. Without a server-side settle,
 * a run with no client attached (cron-dispatched scheduled resume, app closed
 * mid-run) leaves the topic at `running` forever.
 *
 * Returns the settled row, or nothing when the guard didn't match.
 */
export const settleRunningStatus = async (
  ctx: TopicModelContext,
  id: string,
  status: TopicItem['status'] = 'unread',
) => {
  return ctx.db
    .update(topics)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(topics.id, id), eq(topics.status, 'running'), ctx.ownership()))
    .returning({ id: topics.id, status: topics.status });
};

/**
 * Clear a topic's unread mark: `unread` → `active`.
 *
 * Guarded on `status = 'unread'` like `settleRunningStatus`, so a reader acting
 * on a stale copy of the row (a persisted list, another tab) degrades to a no-op
 * instead of overwriting a status that has moved on — a run started since, or
 * one now waiting for a human.
 *
 * Returns the cleared row, or nothing when the topic was not unread.
 */
export const markRead = async (ctx: TopicModelContext, id: string) => {
  return ctx.db
    .update(topics)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(topics.id, id), eq(topics.status, 'unread'), ctx.ownership()))
    .returning({ id: topics.id, status: topics.status });
};

/**
 * Recompute this topic's denormalized usage/cost rollup from its assistant
 * messages. The canonical aggregation lives in `recomputeTopicUsage`; the
 * live path (MessageModel) calls it inline within its own transaction, while
 * external callers use this wrapper. Runs in a transaction for consistency.
 */
export const recomputeUsage = async (ctx: TopicModelContext, id: string) =>
  ctx.db.transaction((trx) => recomputeTopicUsage(trx, ctx.userId, id, ctx.workspaceId));

/**
 * Update topic metadata with merge logic
 * This method merges new metadata with existing metadata instead of replacing it
 */
export interface UpdateMetadataOptions {
  /**
   * Checked against the row's current metadata under the row lock; the write is
   * skipped (and `[]` returned) when it fails. Lets a caller undo its own
   * earlier write without clobbering one that landed after it.
   */
  onlyIf?: (metadata: ChatTopicMetadata | null | undefined) => boolean;
}

export const updateMetadata = async (
  ctx: TopicModelContext,
  id: string,
  metadata: TopicMetadataPatch,
  options?: UpdateMetadataOptions,
) => {
  // Merge into the existing metadata under a row lock so concurrent writers
  // can't lose each other's keys. The old read-then-write was a non-atomic
  // read-modify-write: a hetero run seeds `metadata.runningOperation` while
  // heteroIngest concurrently writes `metadata.heteroCurrentMsgId`, and a write
  // built on a stale snapshot (interleaved read, or a read-replica that hadn't
  // caught up) silently dropped `runningOperation` — stranding the finished
  // task at `task_topics.status = 'running'` because heteroFinish then had no
  // hooks to deliver. `SELECT … FOR UPDATE` forces a primary read + serializes
  // writers on the row, killing both the interleave and replica-lag variants
  // while preserving the exact (shallow + nested onboardingSession) merge.
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');

    // No row (missing or not owned) — nothing to update, mirror the old no-op.
    if (!existing) return [];
    if (options?.onlyIf && !options.onlyIf(existing.metadata)) return [];

    const mergedOnboardingSession =
      existing.metadata?.onboardingSession && metadata.onboardingSession
        ? {
            ...existing.metadata.onboardingSession,
            ...metadata.onboardingSession,
          }
        : metadata.onboardingSession;

    const mergedMetadata = {
      ...existing.metadata,
      ...metadata,
      ...(mergedOnboardingSession && { onboardingSession: mergedOnboardingSession }),
    } as ChatTopicMetadata;

    return tx
      .update(topics)
      .set({ metadata: mergedMetadata })
      .where(and(eq(topics.id, id), ctx.ownership()))
      .returning();
  });
};

/**
 * Switch a topic's pinned model together with its model-scoped effort pin
 * (`metadata.reasoningConfig` / `metadata.heteroEffort`) in one row-locked
 * statement, so neither a concurrent switch nor an in-flight run can observe
 * the new model paired with the previous model's pin. `reasoningConfig` is
 * model-keyed and therefore always replaced (dropped when not provided);
 * `heteroEffort` and `heteroSpeed` are only touched when given.
 */
export const updateModelPin = async (
  ctx: TopicModelContext,
  id: string,
  {
    metadata,
    model,
    provider,
  }: {
    metadata?: Pick<ChatTopicMetadata, 'heteroEffort' | 'heteroSpeed' | 'reasoningConfig'>;
    model: string;
    provider: string;
  },
) =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');

    if (!existing) return [];

    const { reasoningConfig: _stale, ...rest } = existing.metadata ?? {};
    const mergedMetadata: ChatTopicMetadata = {
      ...rest,
      ...(metadata?.heteroEffort !== undefined && { heteroEffort: metadata.heteroEffort }),
      ...(metadata?.heteroSpeed !== undefined && { heteroSpeed: metadata.heteroSpeed }),
      ...(metadata?.reasoningConfig !== undefined && {
        reasoningConfig: metadata.reasoningConfig,
      }),
    };

    return tx
      .update(topics)
      .set({ metadata: mergedMetadata, model, provider, updatedAt: new Date() })
      .where(and(eq(topics.id, id), ctx.ownership()))
      .returning();
  });
