import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  AcceptanceService,
  buildAcceptanceCheckUnion,
  createEvidenceFileResolver,
} from '@/server/services/verify';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const subjectTypeSchema = z.enum(acceptanceSubjectTypes);

const acceptanceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      acceptanceService: new AcceptanceService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

// Writes: workspace mode requires at least the member role (viewers are
// read-only); personal mode passes through unrestricted.
const acceptanceWriteProcedure = acceptanceProcedure.use(requireWorkspaceRoleWhenScoped('member'));

const resolveAcceptance = async (
  ctx: { acceptanceService: AcceptanceService },
  id: string,
): Promise<AcceptanceItem> => {
  const acceptance = await ctx.acceptanceService.acceptanceModel.findById(id);

  if (!acceptance) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
  }

  return acceptance;
};

export const acceptanceRouter = router({
  /**
   * The user accepts the delivery — the terminal business event that closes
   * the acceptance lifecycle. The verifier's verdict is a recommendation; this
   * click is the event (a failed/uncertain round can still be accepted, which
   * means the user knowingly takes it with its exceptions).
   */
  accept: acceptanceWriteProcedure
    .input(z.object({ comment: z.string().max(2000).optional(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      return ctx.acceptanceService.accept(acceptance.id, input.comment);
    }),

  /**
   * Chain an existing verify run onto an acceptance as its next round.
   * Idempotent when the run is already chained to the same acceptance (the
   * ingest CLI re-runs against a remembered session).
   */
  attachRun: acceptanceWriteProcedure
    .input(z.object({ acceptanceId: z.string(), verifyRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.acceptanceId);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      // The attach rewrites the RUN's acceptance_id/round_index too — and a
      // workspace-visible run is not necessarily the caller's. Creator-scope it
      // like every other verify write, or a member could chain another
      // member's report onto their aggregate.
      const run = await new VerifyRunModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).findById(input.verifyRunId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification run not found' });
      }
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      try {
        return await ctx.acceptanceService.attachRun(run.id, acceptance.id);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to attach run',
        });
      }
    }),

  /** Get (or lazily create) the aggregate for a subject — the ingest entry point. */
  ensure: acceptanceWriteProcedure
    .input(
      z.object({
        requirement: z.string().max(2000).optional(),
        subjectId: z.string(),
        subjectType: subjectTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.acceptanceService.ensureForSubject(input.subjectType, input.subjectId, {
          requirement: input.requirement,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Acceptance subject not found',
        });
      }
    }),

  /** The acceptance row for a subject, or null when none exists yet. */
  getBySubject: acceptanceProcedure
    .input(z.object({ subjectId: z.string(), subjectType: subjectTypeSchema }))
    .query(async ({ ctx, input }) => {
      const acceptance = await ctx.acceptanceService.acceptanceModel.findBySubject(
        input.subjectType,
        input.subjectId,
      );
      return acceptance ?? null;
    }),

  /**
   * One-shot payload for the acceptance decision workspace: the aggregate, its
   * subject header, the round ledger (each round's run + report), and the
   * cross-round check union — every check ever planned, with its final verdict,
   * final evidence (file-URL enriched) and round provenance.
   */
  getBundle: acceptanceProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);

      const [subject, { evidence, reports, results, runs }] = await Promise.all([
        ctx.acceptanceService.resolveSubject(acceptance),
        ctx.acceptanceService.loadRounds(acceptance.id),
      ]);

      const resultsByRun = new Map<string, typeof results>();
      for (const result of results) {
        const key = result.verifyRunId!;
        const bucket = resultsByRun.get(key) ?? [];
        bucket.push(result);
        resultsByRun.set(key, bucket);
      }

      const checks = buildAcceptanceCheckUnion(
        runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
      );

      // Enrich the evidence backing every executed timeline step — the final
      // round's artifacts render inline on the row; earlier steps' artifacts
      // render inside the check's iteration-history timeline.
      const resolveFileMeta = createEvidenceFileResolver(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );
      const timelineResultIds = new Set(
        checks.flatMap((check) => check.timeline.map((entry) => entry.resultId)),
      );
      const enriched = await Promise.all(
        evidence
          .filter((e) => timelineResultIds.has(e.checkResultId))
          .map(async (e) => ({ ...e, ...(await resolveFileMeta(e.fileId ?? null)) })),
      );
      const evidenceByResult = new Map<string, typeof enriched>();
      for (const e of enriched) {
        const bucket = evidenceByResult.get(e.checkResultId) ?? [];
        bucket.push(e);
        evidenceByResult.set(e.checkResultId, bucket);
      }

      const reportsByRun = new Map(reports.map((r) => [r.verifyRunId!, r]));
      const rounds = runs.map((run) => ({
        report: reportsByRun.get(run.id) ?? null,
        run,
      }));
      const latestReport = [...rounds].reverse().find((r) => r.report)?.report ?? null;

      return {
        acceptance,
        checks: checks.map((check) => ({
          ...check,
          evidence: check.result ? (evidenceByResult.get(check.result.id) ?? []) : [],
          timeline: check.timeline.map((entry) => ({
            ...entry,
            evidence: evidenceByResult.get(entry.resultId) ?? [],
          })),
        })),
        latestReport,
        rounds,
        subject,
      };
    }),

  /** Recent acceptances, newest first — the CLI list surface. */
  list: acceptanceProcedure.query(async ({ ctx }) => ctx.acceptanceService.acceptanceModel.query()),

  /**
   * The user rejects the delivery. The comment is a re-tasking input: it is
   * recorded on the current round's decision and seeds the next repair/verify
   * round (spawned by the runtime for agent rounds, or by the next
   * `lh verify ingest-report` for harness rounds).
   */
  reject: acceptanceWriteProcedure
    .input(z.object({ comment: z.string().min(1).max(2000), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      return ctx.acceptanceService.reject(acceptance.id, input.comment);
    }),
});
