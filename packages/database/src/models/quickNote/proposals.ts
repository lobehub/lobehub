import type { QuickNoteProposalPayload } from '@lobechat/types';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import { quickNoteProposals, quickNoteRuns, quickNotes } from '../../schemas';
import { ownedQuickNoteIds, type QuickNoteContext, quickNoteOwnershipWhere } from './context';
import type { QuickNoteProposalDraft } from './types';

export const queryProposals = async (ctx: QuickNoteContext, quickNoteId: string) =>
  ctx.db
    .select({
      createdAt: quickNoteProposals.createdAt,
      decidedAt: quickNoteProposals.decidedAt,
      decisionStatus: quickNoteProposals.decisionStatus,
      dismissReason: quickNoteProposals.dismissReason,
      id: quickNoteProposals.id,
      kind: quickNoteProposals.kind,
      originalPayload: quickNoteProposals.originalPayload,
      payload: quickNoteProposals.payload,
      preset: quickNoteProposals.preset,
      resultId: quickNoteProposals.resultId,
      resultType: quickNoteProposals.resultType,
      runId: quickNoteProposals.runId,
      sourceHistoryId: quickNoteProposals.sourceHistoryId,
      updatedAt: quickNoteProposals.updatedAt,
      validity: quickNoteProposals.validity,
    })
    .from(quickNoteProposals)
    .innerJoin(quickNotes, eq(quickNotes.id, quickNoteProposals.quickNoteId))
    .where(and(eq(quickNoteProposals.quickNoteId, quickNoteId), quickNoteOwnershipWhere(ctx)))
    .orderBy(desc(quickNoteProposals.createdAt), desc(quickNoteProposals.id));

/**
 * Persists one inert Proposal produced by a Run of the same owned Quick Note.
 *
 * Returns:
 * - The pending, current Proposal with `original_payload` equal to `payload`, or `undefined` when
 *   the Run does not belong to an owned Quick Note matching `quickNoteId`.
 */
export const createProposal = async (
  ctx: QuickNoteContext,
  params: QuickNoteProposalDraft & {
    quickNoteId: string;
    runId: string;
    sourceHistoryId: string;
  },
) => {
  const [run] = await ctx.db
    .select({ id: quickNoteRuns.id })
    .from(quickNoteRuns)
    .where(
      and(
        eq(quickNoteRuns.id, params.runId),
        eq(quickNoteRuns.quickNoteId, params.quickNoteId),
        inArray(quickNoteRuns.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    );
  if (!run) return undefined;

  const [proposal] = await ctx.db
    .insert(quickNoteProposals)
    .values({
      kind: params.kind,
      originalPayload: params.payload,
      payload: params.payload,
      preset: params.preset ?? null,
      quickNoteId: params.quickNoteId,
      runId: params.runId,
      sourceHistoryId: params.sourceHistoryId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    })
    .returning();

  return proposal;
};

/**
 * Overwrites the payload of an owned, still-pending Proposal; `original_payload` is kept.
 *
 * Returns:
 * - The updated Proposal, or `undefined` when inaccessible or already decided.
 */
export const updateProposalPayload = async (
  ctx: QuickNoteContext,
  proposalId: string,
  payload: QuickNoteProposalPayload,
) => {
  const [proposal] = await ctx.db
    .update(quickNoteProposals)
    .set({ payload, updatedAt: new Date() })
    .where(
      and(
        eq(quickNoteProposals.id, proposalId),
        eq(quickNoteProposals.decisionStatus, 'pending'),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();

  return proposal;
};

/** Marks current pending Proposals stale after their Quick Note source changed. */
export const markPendingProposalsStale = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  updatedAt: Date,
) => {
  await ctx.db
    .update(quickNoteProposals)
    .set({ updatedAt, validity: 'stale' })
    .where(
      and(
        eq(quickNoteProposals.quickNoteId, quickNoteId),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
        eq(quickNoteProposals.decisionStatus, 'pending'),
        eq(quickNoteProposals.validity, 'current'),
      ),
    );
};

/**
 * Marks every still-pending Proposal of earlier Runs as superseded by a newer judgement.
 *
 * Use when:
 * - A Run of `exceptRunId` judged the current source, so its decision is authoritative: earlier
 *   pending suggestions are replaced whether or not the meaning check had marked them stale (with
 *   Auto Analyze on, the new Run usually lands before that check). Applied or dismissed Proposals
 *   keep their record.
 *
 * Returns:
 * - The superseded Proposals.
 */
export const supersedeEarlierProposals = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  exceptRunId: string,
) =>
  ctx.db
    .update(quickNoteProposals)
    .set({ updatedAt: new Date(), validity: 'superseded' })
    .where(
      and(
        eq(quickNoteProposals.quickNoteId, quickNoteId),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
        eq(quickNoteProposals.decisionStatus, 'pending'),
        ne(quickNoteProposals.validity, 'superseded'),
        ne(quickNoteProposals.runId, exceptRunId),
      ),
    )
    .returning();

/** Reads one owned Proposal in any decision state, or `undefined` when inaccessible. */
export const findProposal = async (ctx: QuickNoteContext, proposalId: string) => {
  const [proposal] = await ctx.db
    .select()
    .from(quickNoteProposals)
    .where(
      and(
        eq(quickNoteProposals.id, proposalId),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    );

  return proposal;
};

/**
 * Locks an owned, pending Proposal row for an executor applying it.
 *
 * Expects:
 * - Runs inside the executor's transaction; stale Proposals stay applicable.
 *
 * Returns:
 * - The locked Proposal, or `undefined` when inaccessible or already decided.
 */
export const lockPendingProposal = async (ctx: QuickNoteContext, proposalId: string) => {
  const [proposal] = await ctx.db
    .select()
    .from(quickNoteProposals)
    .where(
      and(
        eq(quickNoteProposals.id, proposalId),
        eq(quickNoteProposals.decisionStatus, 'pending'),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .for('update');

  return proposal;
};

/**
 * Records the user's decision on an owned, pending Proposal.
 *
 * Expects:
 * - `reason` is stored only for dismissals.
 *
 * Returns:
 * - The decided Proposal with `decided_at` set, or `undefined` when inaccessible or decided.
 */
export const decideProposal = async (
  ctx: QuickNoteContext,
  proposalId: string,
  decisionStatus: 'accepted' | 'dismissed',
  reason?: string | null,
) => {
  const decidedAt = new Date();
  const [proposal] = await ctx.db
    .update(quickNoteProposals)
    .set({
      decidedAt,
      decisionStatus,
      dismissReason: decisionStatus === 'dismissed' ? reason?.trim() || null : null,
      updatedAt: decidedAt,
    })
    .where(
      and(
        eq(quickNoteProposals.id, proposalId),
        eq(quickNoteProposals.decisionStatus, 'pending'),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();

  return proposal;
};

/**
 * Accepts an owned Proposal and records the product object its executor produced.
 *
 * Idempotent on the Proposal id: a repeated call after a successful apply returns the already
 * accepted Proposal instead of failing.
 *
 * Returns:
 * - The accepted Proposal with `result_type` / `result_id`, or `undefined` when inaccessible,
 *   dismissed, or accepted without a recorded result.
 */
export const markProposalApplied = async (
  ctx: QuickNoteContext,
  proposalId: string,
  resultType: string,
  resultId: string,
) => {
  const decidedAt = new Date();
  const [applied] = await ctx.db
    .update(quickNoteProposals)
    .set({
      decidedAt,
      decisionStatus: 'accepted',
      resultId,
      resultType,
      updatedAt: decidedAt,
    })
    .where(
      and(
        eq(quickNoteProposals.id, proposalId),
        eq(quickNoteProposals.decisionStatus, 'pending'),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();
  if (applied) return applied;

  const [existing] = await ctx.db
    .select()
    .from(quickNoteProposals)
    .where(
      and(
        eq(quickNoteProposals.id, proposalId),
        inArray(quickNoteProposals.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    );

  return existing?.decisionStatus === 'accepted' && existing.resultId ? existing : undefined;
};
