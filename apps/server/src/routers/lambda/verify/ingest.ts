import { normalizeEvidenceMetadata } from '@lobechat/const/verify';
import type {
  VerifyCheckItem,
  VerifyCheckResultMetadata,
  VerifyEvidenceType,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { FileModel } from '@/database/models/file';
import type { VerifyRunModel } from '@/database/models/verifyRun';
import { evidenceTypeForStoredFile, resolveLiveRoundForItem } from '@/server/services/verify';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import {
  resolveCheckResult,
  resolveVerifyRun,
  verifyProcedure,
  verifyWriteProcedure,
} from './procedures';
import { verdictSchema, verifierTypeSchema } from './schemas';

const checkStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  // Verifier could not run (infra failure) — carries no verdict.
  'errored',
  'skipped',
]);

const evidenceTypeSchema = z.enum([
  'screenshot',
  'gif',
  'video',
  'audio',
  'text',
  'markdown',
  'dom_snapshot',
  'transcript',
]);

const evidenceCapturedBySchema = z.enum(['agent-browser', 'cdp', 'cli', 'program', 'llm_judge']);

const toulminSchema = z.object({
  counterEvidence: z.string().optional(),
  evidence: z.string().optional(),
  limitation: z.string().optional(),
  reasoning: z.string().optional(),
});

/** Derive the lifecycle status from a verdict when the caller doesn't pin one. */
const statusForVerdict = (verdict: 'passed' | 'failed' | 'uncertain') =>
  verdict === 'passed' ? ('passed' as const) : ('failed' as const);

const uploadEvidenceInputSchema = z
  .object({
    capturedBy: evidenceCapturedBySchema.optional(),
    // Exactly one of `content` (inline text) or `fileId` (already-uploaded artifact).
    checkResultId: z.string(),
    content: z.string().min(1).optional(),
    description: z.string().optional(),
    fileId: z.string().min(1).optional(),
    metadata: z.unknown().optional(),
    type: evidenceTypeSchema,
  })
  .refine((data) => Boolean(data.content) !== Boolean(data.fileId), {
    message: 'Provide exactly one of `content` or `fileId`.',
  });

/** Resolve a run from an Agent Run operation id — the handle a builder has in
 * the run-start gap, before any result rows (and thus checkResultIds) exist. */
const resolveRunByOperation = async (ctx: { runModel: VerifyRunModel }, operationId: string) => {
  const run = await ctx.runModel.findByOperation(operationId);

  if (!run) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No verification run for this operation' });
  }

  return run;
};

/** Store a file-backed artifact under the medium of the file itself, not the caller's label. */
const storedEvidenceType = async (
  ctx: { fileModel: FileModel },
  type: VerifyEvidenceType,
  fileId?: string | null,
): Promise<VerifyEvidenceType> =>
  fileId ? evidenceTypeForStoredFile(type, await ctx.fileModel.findById(fileId)) : type;

export const ingestProcedures = {
  ingestResult: verifyWriteProcedure
    .input(
      z
        .object({
          checkItemId: z.string(),
          checkItemIndex: z.number().optional(),
          checkItemTitle: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          metadata: z.unknown().nullish(),
          required: z.boolean().optional(),
          status: checkStatusSchema.optional(),
          // `.nullish()` (not `.optional()`) so a re-ingest can pass an explicit
          // `null` to CLEAR a prior suggestion/observation — `undefined` would be
          // dropped from the conflict UPDATE and leave the stale value on the row,
          // breaking the full-replace guarantee. See the ingest-report caller.
          suggestion: z.string().nullish(),
          toulmin: toulminSchema.nullish(),
          // Optional so an infra failure can be recorded as `status: 'errored'`
          // with no verdict (the verifier never produced a judgment).
          verdict: verdictSchema.optional(),
          verifierType: verifierTypeSchema.optional(),
          verifyRunId: z.string(),
        })
        // A row needs either a verdict (→ derives status) or an explicit status
        // (e.g. `errored`); otherwise there's nothing to record.
        .refine((v) => v.verdict !== undefined || v.status !== undefined, {
          message: 'Either a verdict or an explicit status is required.',
          path: ['verdict'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await resolveVerifyRun(ctx, input.verifyRunId);
      // The conflict-update overwrites the run's existing result rows.
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      return ctx.resultModel.upsertByCheckItem({
        checkItemId: input.checkItemId,
        checkItemIndex: input.checkItemIndex,
        checkItemTitle: input.checkItemTitle,
        completedAt: new Date(),
        confidence: input.confidence,
        metadata: input.metadata as VerifyCheckResultMetadata | null | undefined,
        required: input.required ?? true,
        // Prefer an explicit status; else derive from the verdict (the refine
        // guarantees at least one is present).
        status: input.status ?? (input.verdict ? statusForVerdict(input.verdict) : 'errored'),
        suggestion: input.suggestion,
        toulmin: input.toulmin,
        verdict: input.verdict,
        verifierType: input.verifierType ?? 'agent',
        verifyRunId: run.id,
      });
    }),
  // Prune one check result (ownership-scoped; its evidence cascades). The
  // re-ingest path calls this for cases a later report round dropped, so
  // updating a session in place stays a full replace and never accretes stale
  // checks. resolveCheckResult 404s a result that isn't the caller's.
  deleteResult: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.id);
      assertWorkspaceRowManageable(ctx, result.userId, 'verify result');

      await ctx.resultModel.delete(result.id);
      return { id: result.id, success: true };
    }),
  uploadEvidence: verifyWriteProcedure
    .input(uploadEvidenceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.checkResultId);
      // Attaching evidence mutates another member's result — creator-scoped,
      // mirroring submitCheckEvidence.
      assertWorkspaceRowManageable(ctx, result.userId, 'verify result');
      const type = await storedEvidenceType(ctx, input.type, input.fileId);

      return ctx.evidenceModel.create({
        capturedAt: new Date(),
        capturedBy: input.capturedBy ?? null,
        checkResultId: result.id,
        content: input.content ?? null,
        description: input.description ?? null,
        fileId: input.fileId ?? null,
        metadata: normalizeEvidenceMetadata(input.metadata, type) ?? null,
        type,
      });
    }),
  /**
   * Builder self-evidence contract: submit a check item's verdict AND its
   * evidence in one call. The check_result row is created lazily (idempotent
   * upsert on `(verifyRunId, checkItemId)`) so the builder doesn't need a
   * pre-existing `checkResultId` — solving the run-start handle gap. Evidence
   * is optional (attach mid-run) and verdict is optional (set later by review).
   */
  submitCheckEvidence: verifyWriteProcedure
    .input(
      z
        .object({
          checkItemId: z.string(),
          checkItemIndex: z.number().optional(),
          checkItemTitle: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          evidence: z
            .array(
              z
                .object({
                  capturedBy: evidenceCapturedBySchema.optional(),
                  content: z.string().min(1).optional(),
                  description: z.string().optional(),
                  fileId: z.string().min(1).optional(),
                  type: evidenceTypeSchema,
                })
                .refine((e) => Boolean(e.content) !== Boolean(e.fileId), {
                  message: 'Provide exactly one of `content` or `fileId`.',
                }),
            )
            .optional(),
          // The builder may hold only its Agent Run operationId (run-start gap);
          // either handle resolves the session.
          operationId: z.string().optional(),
          required: z.boolean().optional(),
          status: checkStatusSchema.optional(),
          suggestion: z.string().optional(),
          toulmin: toulminSchema.optional(),
          verdict: verdictSchema.optional(),
          verifierType: verifierTypeSchema.optional(),
          verifyRunId: z.string().optional(),
        })
        .refine((d) => Boolean(d.verifyRunId) || Boolean(d.operationId), {
          message: 'Provide either `verifyRunId` or `operationId`.',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const namedRun = input.verifyRunId
        ? await resolveVerifyRun(ctx, input.verifyRunId)
        : await resolveRunByOperation(ctx, input.operationId!);
      // The idempotent upsert overwrites the run's existing result rows.
      assertWorkspaceRowManageable(ctx, namedRun.userId, 'verify run');
      // A round whose failure already spawned a repair is never judged again;
      // land the submission on the round the repair will be judged in.
      const run = await resolveLiveRoundForItem(ctx, namedRun, input.checkItemId);
      if (run.id !== namedRun.id) assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      // `required` / `verifierType` / index / title are stable per plan item, so
      // hydrate them from the run plan rather than hardcoding defaults — otherwise
      // an evidence-only submit would flip a soft criterion to required:true on the
      // conflict-update. `status` is mutable lifecycle state: omit it when there's
      // no verdict so an existing row keeps its status (and a new row falls to the
      // DB default 'pending') instead of being reset to 'running'. drizzle omits
      // undefined fields from both the insert and the conflict-update.
      const plan = (run.plan as VerifyCheckItem[] | null) ?? [];
      const planItem = plan.find((i) => i.id === input.checkItemId);
      // A planned run owns its checklist. An unknown id used to be upserted as a
      // new row that fell to the column default `required: true`, minting a
      // phantom required check no later round ever plans or re-answers — and the
      // Goal review then judged its stale evidence forever. Name the valid ids
      // so the caller can resubmit under the right one.
      if (plan.length > 0 && !planItem)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Check item "${input.checkItemId}" is not in this verification run's plan. Use one of: ${plan
            .map((item) => `${item.id} (${item.title})`)
            .join('; ')}`,
        });

      const checkResult = await ctx.resultModel.upsertByCheckItem({
        checkItemId: input.checkItemId,
        checkItemIndex: input.checkItemIndex ?? planItem?.index,
        checkItemTitle: input.checkItemTitle ?? planItem?.title,
        completedAt: input.verdict ? new Date() : undefined,
        confidence: input.confidence,
        required: input.required ?? planItem?.required,
        status: input.status ?? (input.verdict ? statusForVerdict(input.verdict) : undefined),
        suggestion: input.suggestion,
        toulmin: input.toulmin,
        verdict: input.verdict,
        verifierType: input.verifierType ?? planItem?.verifierType ?? 'agent',
        verifyRunId: run.id,
      });

      const evidence = input.evidence?.length
        ? await Promise.all(
            input.evidence.map(async (e) =>
              ctx.evidenceModel.create({
                capturedAt: new Date(),
                capturedBy: e.capturedBy ?? null,
                checkResultId: checkResult.id,
                content: e.content ?? null,
                description: e.description ?? null,
                fileId: e.fileId ?? null,
                type: await storedEvidenceType(ctx, e.type, e.fileId),
              }),
            ),
          )
        : [];

      return { checkResult, evidence };
    }),
  listEvidence: verifyProcedure
    .input(z.object({ checkResultId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.checkResultId);
      return ctx.evidenceModel.listByCheckResult(result.id);
    }),
  deleteEvidence: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const evidence = await ctx.evidenceModel.findById(input.id);

      if (!evidence) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification evidence not found' });
      }
      assertWorkspaceRowManageable(ctx, evidence.userId, 'verify evidence');

      await ctx.evidenceModel.delete(evidence.id);
      return { id: evidence.id, success: true };
    }),
};
