import type {
  QuickNoteRunDecision,
  QuickNoteRunError,
  QuickNoteRunExecutionConfig,
  QuickNoteRunInputSnapshot,
} from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import {
  documentHistories,
  documents,
  quickNoteComments,
  quickNoteProposals,
  quickNoteRuns,
  quickNotes,
} from '../../schemas';
import { ownedQuickNoteIds, type QuickNoteContext, quickNoteOwnershipWhere } from './context';
import type { ClaimQuickNoteRunParams, CompleteQuickNoteRunParams } from './types';

/** The pending or running Run of one kind for a Quick Note, if any. */
export const findActiveRun = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  kind: ClaimQuickNoteRunParams['kind'],
) => {
  const [run] = await ctx.db
    .select()
    .from(quickNoteRuns)
    .where(
      and(
        eq(quickNoteRuns.quickNoteId, quickNoteId),
        eq(quickNoteRuns.kind, kind),
        inArray(quickNoteRuns.status, ['pending', 'running']),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .limit(1);

  return run;
};

/**
 * Reads the newest completed Run of one kind for a Quick Note.
 *
 * Use when:
 * - A meaning-change check needs the source text the latest judgement saw (`input_snapshot`).
 *
 * Returns:
 * - The Run, or `undefined` when the note has no completed Run of that kind or is not owned.
 */
export const findLatestCompletedRun = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  kind: ClaimQuickNoteRunParams['kind'],
) => {
  const [run] = await ctx.db
    .select({ id: quickNoteRuns.id })
    .from(quickNoteRuns)
    .where(
      and(
        eq(quickNoteRuns.quickNoteId, quickNoteId),
        eq(quickNoteRuns.kind, kind),
        eq(quickNoteRuns.status, 'completed'),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .orderBy(sql`${quickNoteRuns.completedAt} DESC NULLS LAST`, desc(quickNoteRuns.createdAt))
    .limit(1);

  return run;
};

/**
 * Reads the Comments and pending Proposals a new Run's input snapshot records.
 *
 * Returns:
 * - Comments oldest first and pending Proposals oldest first, both scoped to an owned Quick Note.
 */
export const collectRunInputs = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
): Promise<Pick<QuickNoteRunInputSnapshot, 'comments' | 'pendingProposals'>> => {
  const [comments, pendingProposals] = await Promise.all([
    ctx.db
      .select({ content: quickNoteComments.content, id: quickNoteComments.id })
      .from(quickNoteComments)
      .where(
        and(
          eq(quickNoteComments.quickNoteId, quickNoteId),
          inArray(quickNoteComments.quickNoteId, ownedQuickNoteIds(ctx)),
        ),
      )
      .orderBy(asc(quickNoteComments.createdAt), asc(quickNoteComments.id)),
    ctx.db
      .select({
        id: quickNoteProposals.id,
        kind: quickNoteProposals.kind,
        payload: quickNoteProposals.payload,
      })
      .from(quickNoteProposals)
      .where(
        and(
          eq(quickNoteProposals.quickNoteId, quickNoteId),
          eq(quickNoteProposals.decisionStatus, 'pending'),
          inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
        ),
      )
      .orderBy(asc(quickNoteProposals.createdAt), asc(quickNoteProposals.id)),
  ]);

  return { comments, pendingProposals };
};

/**
 * Inserts a pending Run against a pinned source revision with its rendered input snapshot.
 *
 * Returns `undefined` when the Quick Note is not the caller's, when `sourceHistoryId` is not a
 * revision of its Document, or when a concurrent claimant already holds the active Run of this
 * kind (partial unique index on pending/running Runs).
 */
export const insertPendingRun = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  sourceHistoryId: string,
  params: Pick<ClaimQuickNoteRunParams, 'kind' | 'trigger'> & {
    inputSnapshot: QuickNoteRunInputSnapshot;
  },
) => {
  const [source] = await ctx.db
    .select({ id: documentHistories.id })
    .from(quickNotes)
    .innerJoin(documentHistories, eq(documentHistories.documentId, quickNotes.documentId))
    .where(
      and(
        eq(quickNotes.id, quickNoteId),
        eq(documentHistories.id, sourceHistoryId),
        quickNoteOwnershipWhere(ctx),
      ),
    );
  if (!source) return undefined;

  const [run] = await ctx.db
    .insert(quickNoteRuns)
    .values({
      inputSnapshot: params.inputSnapshot,
      kind: params.kind,
      quickNoteId,
      sourceHistoryId,
      trigger: params.trigger,
    })
    .onConflictDoNothing({
      target: [quickNoteRuns.quickNoteId, quickNoteRuns.kind],
      where: sql`${quickNoteRuns.status} IN ('pending', 'running')`,
    })
    .returning();

  return run;
};

/**
 * Reads an owned Run with the source snapshots and Quick Note metadata completion needs.
 *
 * Returns:
 * - The Run snapshot, or `undefined` when inaccessible.
 */
export const findRunForCompletion = async (ctx: QuickNoteContext, runId: string) => {
  const [run] = await ctx.db
    .select({
      analyzeDueAt: quickNotes.analyzeDueAt,
      quickNoteId: quickNoteRuns.quickNoteId,
      sourceDocumentEditorData: documents.editorData,
      sourceHistoryEditorData: documentHistories.editorData,
      sourceHistoryId: quickNoteRuns.sourceHistoryId,
      status: quickNoteRuns.status,
      tags: quickNotes.tags,
    })
    .from(quickNoteRuns)
    .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
    .innerJoin(documents, eq(documents.id, quickNotes.documentId))
    .innerJoin(documentHistories, eq(documentHistories.id, quickNoteRuns.sourceHistoryId))
    .where(and(eq(quickNoteRuns.id, runId), quickNoteOwnershipWhere(ctx)));

  return run;
};

/**
 * Completes a Run with its accepted output and refreshes the parent Quick Note metadata.
 *
 * Expects:
 * - Runs inside a transaction; the parent Quick Note row stays locked until it commits.
 * - `run` identifies the Run's note and pinned source revision. Whether that revision is still
 *   current is re-read after the lock, not taken from an earlier snapshot: a save that committed
 *   in between would otherwise have its new due time cleared by an outdated Run.
 * - A stale Run (source edited since its snapshot) keeps the Quick Note's due time and tags.
 *
 * Returns:
 * - The completed Run and whether its source is still current, or `undefined` when it is
 *   inaccessible or no longer pending/running.
 */
export const completeRun = async (
  ctx: QuickNoteContext,
  runId: string,
  run: { quickNoteId: string; sourceHistoryEditorData: unknown },
  output: Pick<CompleteQuickNoteRunParams, 'decision' | 'summary' | 'tags'>,
) => {
  const [completed] = await ctx.db
    .update(quickNoteRuns)
    .set({
      completedAt: new Date(),
      // A decision recorded earlier by `recordRunDecision` survives unless one is passed here.
      ...(output.decision === undefined ? {} : { decision: output.decision }),
      status: 'completed',
      summary: output.summary?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(quickNoteRuns.id, runId),
        inArray(quickNoteRuns.status, ['pending', 'running']),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();
  if (!completed) return undefined;

  // A source save writes the Document and then this row in one transaction, so holding the row
  // lock means no newer source can commit before this completion does. The lock is its own
  // statement: a locking read that waited would re-check only the locked row, not the Document.
  await ctx.db
    .select({ id: quickNotes.id })
    .from(quickNotes)
    .where(and(eq(quickNotes.id, run.quickNoteId), quickNoteOwnershipWhere(ctx)))
    .for('update');
  const [current] = await ctx.db
    .select({ editorData: documents.editorData, tags: quickNotes.tags })
    .from(quickNotes)
    .innerJoin(documents, eq(documents.id, quickNotes.documentId))
    .where(and(eq(quickNotes.id, run.quickNoteId), quickNoteOwnershipWhere(ctx)));
  if (!current) return undefined;

  const sourceIsCurrent = isEqual(current.editorData, run.sourceHistoryEditorData);
  // A stale Run remains auditable, but its interpretation must not mutate current metadata.
  if (sourceIsCurrent) {
    await ctx.db
      .update(quickNotes)
      .set({
        analyzeDueAt: null,
        tags: output.tags ? [...new Set([...current.tags, ...output.tags])] : current.tags,
        updatedAt: new Date(),
      })
      .where(and(eq(quickNotes.id, run.quickNoteId), quickNoteOwnershipWhere(ctx)));
  }

  return { run: completed, sourceIsCurrent };
};

/**
 * Records the intent judgement on an owned Run that has not reached a terminal status.
 *
 * Use when:
 * - The first-step decision answered before any follow-up Agent run starts.
 *
 * Returns:
 * - The updated Run, or `undefined` when inaccessible or already terminal.
 */
export const recordRunDecision = async (
  ctx: QuickNoteContext,
  runId: string,
  decision: QuickNoteRunDecision,
) => {
  const [run] = await ctx.db
    .update(quickNoteRuns)
    .set({ decision, updatedAt: new Date() })
    .where(
      and(
        eq(quickNoteRuns.id, runId),
        inArray(quickNoteRuns.status, ['pending', 'running']),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();

  return run;
};

export const attachOperation = async (
  ctx: QuickNoteContext,
  runId: string,
  params: {
    agentId: string;
    executionConfig: QuickNoteRunExecutionConfig;
    operationId: string;
    /** Topic the operation created or reused for this Run. */
    topicId?: string | null;
  },
) => {
  const [run] = await ctx.db
    .update(quickNoteRuns)
    .set({
      agentId: params.agentId,
      executionConfig: params.executionConfig,
      operationId: params.operationId,
      startedAt: new Date(),
      status: 'running',
      topicId: params.topicId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(quickNoteRuns.id, runId),
        eq(quickNoteRuns.status, 'pending'),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();

  return run;
};

/** Consecutive failed Analyze Runs of one source version after which automatic retries stop. */
export const QUICK_NOTE_MAX_AUTOMATIC_FAILURES = 3;
/** Delay before the first automatic retry of a failed Analyze Run; doubles per failure. */
export const QUICK_NOTE_FAILURE_RETRY_BASE_MS = 60_000;

export const failRun = async (
  ctx: QuickNoteContext,
  runId: string,
  error: QuickNoteRunError,
  options?: {
    /** Only release claims before dispatch has attached an operation. @default false */
    onlyUndispatched?: boolean;
    /**
     * Whether the sweep may try this source version again. `false` for failures a retry cannot
     * fix (the Agent answered, but its output could not be read). @default true
     */
    retryable?: boolean;
  },
) => {
  const [run] = await ctx.db
    .update(quickNoteRuns)
    .set({ completedAt: new Date(), error, status: 'failed', updatedAt: new Date() })
    .where(
      and(
        eq(quickNoteRuns.id, runId),
        options?.onlyUndispatched
          ? and(eq(quickNoteRuns.status, 'pending'), isNull(quickNoteRuns.operationId))
          : inArray(quickNoteRuns.status, ['pending', 'running']),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();

  if (run?.kind === 'analyze') {
    await rescheduleAfterFailure(ctx, run.quickNoteId, options?.retryable ?? true);
  }

  return run;
};

/**
 * Backs off or stops Automatic Analyze after a failed Run, so the sweep cannot re-run a failing
 * note every minute.
 *
 * A failure keeps `analyze_due_at`, which the sweep would claim again at once. Instead, a
 * retryable failure pushes it back (1 min, then 2 min), and after
 * {@link QUICK_NOTE_MAX_AUTOMATIC_FAILURES} consecutive failures of the same source version, or
 * one non-retryable failure, it is cleared. A real edit re-arms it; manual Analyze still works.
 * A failure of an outdated version leaves the newer edit's schedule alone.
 */
const rescheduleAfterFailure = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  retryable: boolean,
) => {
  const [note] = await ctx.db
    .select({ analyzeDueAt: quickNotes.analyzeDueAt, editorData: documents.editorData })
    .from(quickNotes)
    .innerJoin(documents, eq(documents.id, quickNotes.documentId))
    .where(and(eq(quickNotes.id, quickNoteId), quickNoteOwnershipWhere(ctx)));
  if (!note?.analyzeDueAt) return;

  const recentRuns = await ctx.db
    .select({ editorData: documentHistories.editorData, status: quickNoteRuns.status })
    .from(quickNoteRuns)
    .innerJoin(documentHistories, eq(documentHistories.id, quickNoteRuns.sourceHistoryId))
    .where(and(eq(quickNoteRuns.quickNoteId, quickNoteId), eq(quickNoteRuns.kind, 'analyze')))
    .orderBy(desc(quickNoteRuns.createdAt), desc(quickNoteRuns.id))
    .limit(QUICK_NOTE_MAX_AUTOMATIC_FAILURES);
  const currentEditorData = note.editorData ?? { root: { children: [] } };
  const sameVersion = (editorData: unknown) => isEqual(editorData, currentEditorData);
  // The failed Run judged an older revision; the newer edit keeps its own schedule.
  if (!recentRuns[0] || !sameVersion(recentRuns[0].editorData)) return;

  const index = recentRuns.findIndex(
    (item) => item.status !== 'failed' || !sameVersion(item.editorData),
  );
  const failures = index === -1 ? recentRuns.length : index;
  const analyzeDueAt =
    !retryable || failures >= QUICK_NOTE_MAX_AUTOMATIC_FAILURES
      ? null
      : new Date(Date.now() + QUICK_NOTE_FAILURE_RETRY_BASE_MS * 2 ** (failures - 1));

  await ctx.db
    .update(quickNotes)
    .set({ analyzeDueAt })
    .where(and(eq(quickNotes.id, quickNoteId), quickNoteOwnershipWhere(ctx)));
};

export const getRunContext = async (ctx: QuickNoteContext, runId: string) => {
  const [result] = await ctx.db
    .select({
      decision: quickNoteRuns.decision,
      inputSnapshot: quickNoteRuns.inputSnapshot,
      kind: quickNoteRuns.kind,
      operationId: quickNoteRuns.operationId,
      quickNoteId: quickNoteRuns.quickNoteId,
      sourceDocumentId: quickNotes.documentId,
      sourceEditorData: documentHistories.editorData,
      sourceHistoryId: quickNoteRuns.sourceHistoryId,
      status: quickNoteRuns.status,
      topicId: quickNoteRuns.topicId,
      trigger: quickNoteRuns.trigger,
    })
    .from(quickNoteRuns)
    .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
    .innerJoin(documentHistories, eq(documentHistories.id, quickNoteRuns.sourceHistoryId))
    .where(and(eq(quickNoteRuns.id, runId), quickNoteOwnershipWhere(ctx)));

  return result;
};
