import type {
  DeleteDocumentWorkParams,
  DeleteTaskWorkParams,
  WorkItem,
  WorkVersionItem,
} from '@lobechat/types';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { documents } from '../../schemas/file';
import { works, workVersions } from '../../schemas/work';
import type { LobeChatDatabase } from '../../type';
import { documentOwnership, versionOwnership, type WorkContext, workOwnership } from './context';
import type { CreateVersionInput, WorkVersionEventParams } from './internal';

const MAX_VERSION_CREATE_RETRIES = 5;

const isUniqueViolation = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const cause = error instanceof Error ? error.cause : undefined;
  const causeCode =
    typeof cause === 'object' && cause && 'code' in cause
      ? String((cause as { code?: unknown }).code)
      : '';

  return (
    code === '23505' ||
    causeCode === '23505' ||
    message.includes('23505') ||
    message.includes('duplicate') ||
    message.includes('unique')
  );
};

export const findById = async (ctx: WorkContext, workId: string): Promise<WorkItem | null> => {
  const [work] = await ctx.db
    .select()
    .from(works)
    .where(and(eq(works.id, workId), workOwnership(ctx)))
    .limit(1);

  return work ?? null;
};

export const findVersionBySourceToolCall = async (
  ctx: WorkContext,
  workId: string,
  sourceToolCallId?: string | null,
): Promise<WorkVersionItem | null> => {
  if (!sourceToolCallId) return null;

  const [version] = await ctx.db
    .select()
    .from(workVersions)
    .where(
      and(
        versionOwnership(ctx),
        eq(workVersions.workId, workId),
        eq(workVersions.sourceToolCallId, sourceToolCallId),
      ),
    )
    .limit(1);

  return version ?? null;
};

/**
 * `works` has two partial unique indexes (workspace-scoped vs personal);
 * pick the ON CONFLICT target matching this model's scope.
 */
export const resolveWorkUpsertConflict = (ctx: WorkContext) =>
  ctx.workspaceId
    ? {
        target: [works.workspaceId, works.resourceType, works.resourceId],
        targetWhere: isNotNull(works.workspaceId),
      }
    : {
        target: [works.resourceType, works.resourceId, works.userId],
        targetWhere: isNull(works.workspaceId),
      };

/**
 * Shared version-create pipeline: dedupe by sourceToolCallId, allocate the
 * next version number in a transaction, insert the version row, bump
 * works.currentVersionId, and retry on unique-violation races (either the
 * `(workId, version)` or the `(workId, sourceToolCallId)` unique index).
 *
 * `buildInput` runs inside the transaction, after a `FOR UPDATE` lock on the
 * works row (same pattern as `TopicModel.updateMetadata`): a concurrent
 * registration holds that lock until its commit, so the merge base read here
 * (linear/github patch-merge against the previous snapshot) always sees the
 * winner's committed state. Without the lock, a stale merge could allocate the
 * next version number cleanly — never hitting the unique-violation retry — and
 * silently revert fields the concurrent registration just wrote. Callers must
 * do their reads through the tx-scoped context `buildInput` receives.
 */
export const createVersion = async (
  ctx: WorkContext,
  work: WorkItem,
  params: WorkVersionEventParams,
  buildInput: (txCtx: WorkContext) => CreateVersionInput | Promise<CreateVersionInput>,
): Promise<WorkVersionItem> => {
  const existing = await findVersionBySourceToolCall(ctx, work.id, params.sourceToolCallId);
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_VERSION_CREATE_RETRIES; attempt += 1) {
    try {
      return await ctx.db.transaction(async (tx) => {
        const txCtx: WorkContext = { ...ctx, db: tx as LobeChatDatabase };

        const [locked] = await tx
          .select({ id: works.id })
          .from(works)
          .where(and(eq(works.id, work.id), workOwnership(ctx)))
          .for('update');
        // The Work row vanished between upsert and here (e.g. a concurrent
        // deleteTaskWork); inserting a version would only FK-fail, so bail
        // with a clearer error.
        if (!locked) throw new Error(`Work ${work.id} no longer exists`);

        // Re-check dedupe under the lock: a concurrent registration with the
        // same sourceToolCallId that committed before we acquired the lock is
        // now visible, so return its version instead of tripping the
        // `(workId, sourceToolCallId)` unique index.
        const dedupedUnderLock = await findVersionBySourceToolCall(
          txCtx,
          work.id,
          params.sourceToolCallId,
        );
        if (dedupedUnderLock) return dedupedUnderLock;

        const { metadata, snapshot } = await buildInput(txCtx);

        const now = new Date();
        const [next] = await tx
          .select({
            version: sql<number>`COALESCE(MAX(${workVersions.version}), 0) + 1`,
          })
          .from(workVersions)
          .where(eq(workVersions.workId, work.id));

        const [version] = await tx
          .insert(workVersions)
          .values({
            actorAgentId: params.actorAgentId ?? null,
            // Written once at insert time: the agent runtime resolves the tool
            // call's cumulative cost only AFTER execution (in `accumulateTool`),
            // then registers the Work — so cost lands with the row instead of a
            // follow-up UPDATE. Null for non-agent paths (e.g. manual document
            // edits) that carry no cost.
            cumulativeCost: params.cumulativeCost ?? null,
            cumulativeUsage: params.cumulativeUsage ?? null,
            metadata: metadata ?? null,
            role: params.role,
            rootOperationId: params.rootOperationId ?? null,
            snapshot,
            source: params.source,
            sourceMessageId: params.sourceMessageId ?? null,
            sourceToolCallId: params.sourceToolCallId ?? null,
            threadId: params.threadId ?? null,
            topicId: params.topicId ?? null,
            userId: ctx.userId,
            version: Number(next.version),
            workId: work.id,
            workspaceId: ctx.workspaceId ?? null,
          })
          .returning();

        await tx
          .update(works)
          .set({ currentVersionId: version.id, updatedAt: now })
          .where(and(eq(works.id, work.id), workOwnership(ctx)));

        return version;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === MAX_VERSION_CREATE_RETRIES - 1) throw error;

      const existingAfterConflict = await findVersionBySourceToolCall(
        ctx,
        work.id,
        params.sourceToolCallId,
      );
      if (existingAfterConflict) return existingAfterConflict;
    }
  }

  throw new Error(`Failed to create ${work.type} work version after max retries`);
};

export const deleteDocumentWork = async (
  ctx: WorkContext,
  params: DeleteDocumentWorkParams,
): Promise<void> => {
  const [doc] = await ctx.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(documentOwnership(ctx), eq(documents.id, params.documentId)))
    .limit(1);
  if (!doc) return;

  await ctx.db
    .delete(works)
    .where(
      and(workOwnership(ctx), eq(works.resourceType, 'document'), eq(works.resourceId, doc.id)),
    );
};

/**
 * Delete the task Work (and its versions via the `work_versions.workId`
 * cascade) for a task the agent removed through the deleteTask tool.
 *
 * Unlike {@link deleteDocumentWork} this does NOT re-resolve the resource
 * first: the task row is already gone by the time the tool-execution dispatch
 * layer calls this, so we can only locate the Work by its polymorphic
 * `resourceId` (= the task's internal id, captured into `result.state.taskId`
 * before deletion). Ownership still scopes the delete to the caller.
 */
export const deleteTaskWork = async (
  ctx: WorkContext,
  params: DeleteTaskWorkParams,
): Promise<void> => {
  await ctx.db
    .delete(works)
    .where(
      and(workOwnership(ctx), eq(works.resourceType, 'task'), eq(works.resourceId, params.taskId)),
    );
};
