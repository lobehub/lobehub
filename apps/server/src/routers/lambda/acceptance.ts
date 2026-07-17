import {
  acceptanceCheckReviewActions,
  acceptanceSubjectTypes,
  acceptanceVisibilities,
} from '@lobechat/const/verify';
import type { AcceptanceAttachment } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { acceptances } from '@/database/schemas/verify';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  AcceptanceService,
  buildAcceptanceCheckUnion,
  buildCheckReviewOverlay,
  createEvidenceFileResolver,
} from '@/server/services/verify';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const subjectTypeSchema = z.enum(acceptanceSubjectTypes);

/** Reads addressed purely by acceptance id — visibility is checked in the handler. */
const publicAcceptanceProcedure = publicProcedure.use(serverDatabase);

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
   *
   * Public like the verify report viewer: the acceptance URL is meant to be
   * linked from PRs/reports, so a `public` aggregate is readable by anyone
   * holding the id. `private` stays gated to the owner and (for workspace
   * scope) workspace members. A denied read is a NOT_FOUND, never a
   * FORBIDDEN — existence must not leak through the error code.
   */
  getBundle: publicAcceptanceProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const acceptance = await ctx.serverDB.query.acceptances.findFirst({
        where: eq(acceptances.id, input.id),
      });
      if (!acceptance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
      }

      const isOwner = Boolean(ctx.userId) && ctx.userId === acceptance.userId;
      let canRead = isOwner || acceptance.visibility === 'public';
      if (!canRead && ctx.userId && acceptance.workspaceId) {
        const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
          acceptance.workspaceId,
          ctx.userId,
        );
        canRead = Boolean(member);
      }
      if (!canRead) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
      }

      // Sub-reads (rounds / results / evidence) are ownership-scoped models, so
      // read them AS the aggregate's owner — same pattern as the evidence file
      // resolver. The visibility gate above is the actual access decision.
      const ownerService = new AcceptanceService(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );

      const [subject, { evidence, reports, results, runs }] = await Promise.all([
        ownerService.resolveSubject(acceptance),
        ownerService.loadRounds(acceptance.id),
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

      // Resolve the files backing user feedback (uploaded/pasted screenshots)
      // to URLs with the same owner-scoped resolver the evidence uses — one
      // batch for every attachment id across check rejects and group feedback.
      const attachmentIds = new Set<string>();
      for (const result of results)
        for (const id of result.userDecisionDetail?.fileIds ?? []) attachmentIds.add(id);
      for (const run of runs)
        for (const entry of run.decisionDetail?.groupFeedback ?? [])
          for (const id of entry.fileIds ?? []) attachmentIds.add(id);
      const attachmentById = new Map<string, AcceptanceAttachment>();
      await Promise.all(
        [...attachmentIds].map(async (id) => {
          const meta = await resolveFileMeta(id);
          attachmentById.set(id, { id, name: meta.fileName ?? undefined, url: meta.fileUrl });
        }),
      );
      const toAttachments = (fileIds?: string[]): AcceptanceAttachment[] | undefined => {
        if (!fileIds?.length) return undefined;
        const resolved = fileIds
          .map((id) => attachmentById.get(id))
          .filter((a): a is AcceptanceAttachment => Boolean(a));
        return resolved.length > 0 ? resolved : undefined;
      };

      const reportsByRun = new Map(reports.map((r) => [r.verifyRunId!, r]));
      const rounds = runs.map((run) => {
        // `origin` points at the author's private topic/agent — never hand it
        // to a visitor holding nothing but the shared link.
        let publicRun = run;
        if (!isOwner && run.metadata?.origin) {
          const { origin: _origin, ...publicMetadata } = run.metadata;
          publicRun = { ...run, metadata: publicMetadata };
        }
        // Enrich group feedback with resolved attachment URLs for the client.
        const groupFeedback = publicRun.decisionDetail?.groupFeedback;
        if (groupFeedback?.some((entry) => entry.fileIds?.length)) {
          publicRun = {
            ...publicRun,
            decisionDetail: {
              ...publicRun.decisionDetail,
              groupFeedback: groupFeedback.map((entry) => {
                const attachments = toAttachments(entry.fileIds);
                return attachments ? { ...entry, attachments } : entry;
              }),
            },
          };
        }
        return { report: reportsByRun.get(run.id) ?? null, run: publicRun };
      });
      const latestReport = [...rounds].reverse().find((r) => r.report)?.report ?? null;

      // The authoring conversation (agent + topic), resolved for the header —
      // owner-only, same redaction rule as `run.metadata.origin`.
      const origin = isOwner ? await ownerService.resolveOrigin(runs) : null;

      const currentRoundIndex = runs.at(-1)?.roundIndex ?? 0;
      const resultsById = new Map(results.map((result) => [result.id, result]));

      return {
        acceptance,
        isOwner,
        checks: checks.map((check) => {
          // Projected from the result rows' user_decision(+detail) — the
          // events carry no user ids, so nothing needs redacting here.
          const { reviews, userReview } = buildCheckReviewOverlay(
            check,
            resultsById,
            currentRoundIndex,
          );
          // The standing verdict mirrors the latest review — resolve its
          // attachments too so the row's feedback card can render them.
          const resolvedReviews = reviews.map((review) => {
            const attachments = toAttachments(review.fileIds);
            return attachments ? { ...review, attachments } : review;
          });
          const latestAttachments = toAttachments(reviews.at(-1)?.fileIds);
          return {
            ...check,
            evidence: check.result ? (evidenceByResult.get(check.result.id) ?? []) : [],
            reviews: resolvedReviews,
            timeline: check.timeline.map((entry) => ({
              ...entry,
              evidence: evidenceByResult.get(entry.resultId) ?? [],
            })),
            userReview:
              userReview && latestAttachments
                ? { ...userReview, attachments: latestAttachments }
                : userReview,
          };
        }),
        latestReport,
        origin,
        rounds,
        subject,
      };
    }),

  /** Recent acceptances (with subject headers), newest first — list panel + CLI. */
  list: acceptanceProcedure.query(async ({ ctx }) => ctx.acceptanceService.listWithSubjects()),

  /**
   * Feedback addressed to a check GROUP (business category) rather than any
   * single check — for concerns that don't invalidate an individual check
   * (which may well be accepted) but still need to reach the next round.
   * Append-only, stamped with the current round for the same staleness rule
   * as check-level rejects.
   */
  addGroupFeedback: acceptanceWriteProcedure
    .input(
      z.object({
        category: z.string().max(200),
        comment: z.string().trim().min(1).max(2000),
        fileIds: z.array(z.string()).max(10).optional(),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      // The feedback is addressed to the CURRENT round and lives on its run's
      // decision detail — the same home as the round's terminal accept/reject
      // note, so staleness falls out of the round chain and a deleted round
      // takes its feedback along.
      const { runs } = await ctx.acceptanceService.loadRounds(acceptance.id);
      const currentRun = runs.at(-1);
      if (!currentRun) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No verification round to address feedback to',
        });
      }

      const entry = {
        category: input.category,
        comment: input.comment,
        createdAt: new Date().toISOString(),
        ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}),
      };
      await new VerifyRunModel(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      ).appendGroupFeedback(currentRun.id, entry);
      return { entry: { ...entry, roundIndex: currentRun.roundIndex }, success: true };
    }),

  /**
   * The user's verdict on individual union checks — `accept` settles a check
   * for good ("已验收,不用再管"); `reject` records feedback the next verify
   * round reads as its re-tasking input. A group-level "accept all" is the
   * same call with many ids. Independent of the aggregate-level accept/reject:
   * reviewing checks never moves the acceptance lifecycle.
   */
  reviewChecks: acceptanceWriteProcedure
    .input(
      z
        .object({
          action: z.enum(acceptanceCheckReviewActions),
          annotations: z
            .array(
              z.object({
                comment: z.string().max(2000).optional(),
                evidenceId: z.string(),
                rect: z.object({
                  height: z.number().min(0).max(1),
                  width: z.number().min(0).max(1),
                  x: z.number().min(0).max(1),
                  y: z.number().min(0).max(1),
                }),
              }),
            )
            .max(20)
            .optional(),
          checkItemIds: z.array(z.string()).min(1).max(200),
          comment: z.string().max(2000).optional(),
          fileIds: z.array(z.string()).max(10).optional(),
          id: z.string(),
        })
        // A reject IS its feedback — without a note (global, on an annotated
        // region, or a screenshot attachment) the next round has nothing to act on.
        .refine(
          (value) =>
            value.action !== 'reject' ||
            Boolean(value.comment?.trim()) ||
            Boolean(value.annotations?.some((annotation) => annotation.comment?.trim())) ||
            Boolean(value.fileIds?.length),
          { message: 'Rejecting a check requires a comment' },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      try {
        return await ctx.acceptanceService.reviewChecks(acceptance.id, {
          action: input.action,
          annotations: input.annotations,
          checkItemIds: input.checkItemIds,
          comment: input.comment?.trim() || undefined,
          fileIds: input.fileIds,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to review checks',
        });
      }
    }),

  /**
   * Flip who can read the acceptance beyond its creator. Creation defaults are
   * scope-dependent (personal → public, workspace → private); this is the
   * deliberate override.
   */
  setVisibility: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), visibility: z.enum(acceptanceVisibilities) }))
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      const updated = await ctx.acceptanceService.acceptanceModel.update(acceptance.id, {
        visibility: input.visibility,
      });
      // Cascade to every chained round: each round's report page is its own
      // shareable URL, so it must follow the umbrella (clobbering per-round
      // overrides on purpose — the aggregate flip is the deliberate act).
      await new VerifyRunModel(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      ).setVisibilityByAcceptance(acceptance.id, input.visibility);
      return updated;
    }),

  /**
   * The user sent the delivery back for a repair round (the in-app 打回重跑
   * dispatch). Stamps the aggregate `repairing` so every surface reflects the
   * send-back immediately; the next round's ingest recomputes the status from
   * real run state, so a stale stamp cannot stick.
   */
  markRepairing: acceptanceWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const acceptance = await resolveAcceptance(ctx, input.id);
      assertWorkspaceRowManageable(ctx, acceptance.userId, 'acceptance');

      if (acceptance.status !== 'delivered' && acceptance.status !== 'errored') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Only a settled acceptance can be sent back (status: ${acceptance.status})`,
        });
      }
      return ctx.acceptanceService.acceptanceModel.updateStatus(acceptance.id, 'repairing');
    }),

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
