import {
  acceptanceCheckReviewActions,
  acceptanceRejectIntents,
  acceptanceSubjectTypes,
  acceptanceVisibilities,
  reviewAdjudications,
  reviewProposalEdits,
} from '@lobechat/const/verify';
import type { AcceptanceAttachment } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ProjectModel } from '@/database/models/project';
import { VerifyReviewPredictionModel } from '@/database/models/verifyReviewPrediction';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  AcceptanceService,
  buildAcceptanceCheckUnion,
  buildCheckReviewOverlay,
  createEvidenceFileResolver,
  isCurrentReviewPrediction,
  mapWithConcurrency,
  REVIEW_PREDICT_CONCURRENCY,
  REVIEW_PREDICT_MODEL_CONFIG,
  shouldSurfaceProposal,
  VerifyReviewPredictorService,
} from '@/server/services/verify';
import { after } from '@/server/utils/scheduleAfterResponse';

import { canManageAcceptance, filterManageableAcceptances } from './_helpers/acceptanceWriteScope';
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

/**
 * Resolve an acceptance for WRITING, with a service bound to the scope the row
 * actually lives in.
 *
 * Every model write is scoped by `buildWorkspaceWhere`, and `acceptances`
 * carries a `visibility` column — so that predicate narrows PRIVATE rows to
 * `userId = <bound user>`, and workspace acceptances default to private. A
 * service bound to the caller therefore cannot resolve a teammate's row at all,
 * and the write dies as `NOT_FOUND` after authorization already said yes.
 *
 * So the service is bound to the row's OWNER — the one binding that resolves it
 * — while the acting user is carried separately, because decisions record
 * `decidedBy` and an audit trail that credits a teammate's verdict to the
 * author is worse than one nobody can sign.
 */
const resolveAcceptanceForWrite = async (
  ctx: { serverDB: LobeChatDatabase; userId: string },
  id: string,
): Promise<{ acceptance: AcceptanceItem; service: AcceptanceService }> => {
  const acceptance = isUuid(id)
    ? await ctx.serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, id) })
    : undefined;

  // An unauthorized caller gets the same answer as a missing row: the existence
  // of someone else's delivery is not ours to disclose.
  if (!acceptance || !(await canManageAcceptance(ctx, acceptance))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
  }

  return {
    acceptance,
    service: new AcceptanceService(
      ctx.serverDB,
      acceptance.userId,
      acceptance.workspaceId ?? undefined,
      { actorUserId: ctx.userId },
    ),
  };
};

/** Max rows one multi-select sweep may touch — the list itself is capped at 200. */
const ACCEPTANCE_BATCH_LIMIT = 200;

const acceptanceStatusOverrideSchema = z.enum(['delivered', 'accepted', 'closed', 'rejected']);

/**
 * Apply one user-facing lifecycle override to an already-resolved,
 * already-authorized aggregate. Shared by the single-row menu action and the
 * list's multi-select sweep, so both obey exactly the same transition rules.
 *
 * accept / reject go through the SERVICE, never a bare status write: the
 * service applies `requireDecidableAcceptance` (a premature `accepted` is
 * sticky in recomputeStatus and could never be corrected by a later verifier
 * result) and stamps the decision on the current round. Reopen is only
 * meaningful for an already-decided aggregate — a still-running round must
 * not be forced back to a decision-pending state by hand.
 */
const applyAcceptanceStatus = async (
  service: AcceptanceService,
  acceptance: AcceptanceItem,
  status: z.infer<typeof acceptanceStatusOverrideSchema>,
) => {
  if (status === 'accepted') {
    await service.accept(acceptance.id);
    return;
  }

  if (status === 'closed') {
    await service.acceptanceModel.updateStatus(acceptance.id, 'closed');
    return;
  }

  if (status === 'rejected') {
    await service.reject(acceptance.id, 'Rejected from the acceptance list — needs another round.');
    return;
  }

  // Reopen (→ delivered): only a decided aggregate can be re-opened; a live
  // round recomputes its own status and must not be clobbered.
  if (
    acceptance.status !== 'accepted' &&
    acceptance.status !== 'closed' &&
    acceptance.status !== 'rejected'
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Only a decided acceptance can be reopened (status: ${acceptance.status})`,
    });
  }

  await service.acceptanceModel.updateStatus(acceptance.id, 'delivered');
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
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      return service.accept(acceptance.id, input.comment);
    }),

  /**
   * Chain an existing verify run onto an acceptance as its next round.
   * Idempotent when the run is already chained to the same acceptance (the
   * ingest CLI re-runs against a remembered session).
   */
  attachRun: acceptanceWriteProcedure
    .input(z.object({ acceptanceId: z.string(), verifyRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.acceptanceId);

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
        return await service.attachRun(run.id, acceptance.id);
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
        title: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.acceptanceService.ensureForSubject(input.subjectType, input.subjectId, {
          requirement: input.requirement,
          title: input.title,
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
      if (!acceptance) return null;

      // `delivered` alone is ambiguous for the subject's status surface: a
      // converged delivery waiting for sign-off and a failed one waiting for a
      // decision both land there. The latest round's verdict is what tells
      // them apart, so ship it with the aggregate instead of forcing callers
      // to load the whole bundle for one field.
      const latest = await ctx.acceptanceService.latestRound(acceptance.id);
      return {
        ...acceptance,
        latestRunStatus: latest?.status ?? null,
        latestRunUserDecision: latest?.userDecision ?? null,
      };
    }),

  /**
   * Persist a subject's standing acceptance checklist (the topic tray). Ensures
   * the aggregate exists, then writes the list into its `config.checklist` — so
   * the criteria live with the verify aggregate, not in client storage.
   */
  saveChecklist: acceptanceWriteProcedure
    .input(
      z.object({
        checklist: z.array(
          z.object({
            id: z.string(),
            method: z.string().optional(),
            name: z.string(),
          }),
        ),
        subjectId: z.string(),
        subjectType: subjectTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const aggregate = await ctx.acceptanceService.ensureForSubject(
          input.subjectType,
          input.subjectId,
        );
        await ctx.acceptanceService.acceptanceModel.update(aggregate.id, {
          config: { ...aggregate.config, checklist: input.checklist },
        });
        return { checklist: input.checklist, id: aggregate.id };
      } catch (error) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Acceptance subject not found',
        });
      }
    }),

  /**
   * Set (or update) a subject's acceptance goal — the one-sentence outcome the
   * conversation is delivering. Unlike `ensure`, this overwrites: the goal is a
   * user-editable field, so a later edit must stick.
   */
  saveGoal: acceptanceWriteProcedure
    .input(
      z.object({
        requirement: z.string().max(2000),
        subjectId: z.string(),
        subjectType: subjectTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const aggregate = await ctx.acceptanceService.ensureForSubject(
          input.subjectType,
          input.subjectId,
        );
        await ctx.acceptanceService.acceptanceModel.update(aggregate.id, {
          requirement: input.requirement,
        });
        return { id: aggregate.id, requirement: input.requirement };
      } catch (error) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Acceptance subject not found',
        });
      }
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
      // Public entry fed by shared links: a chat autolinker can glue trailing
      // CJK punctuation onto the URL, so a malformed uuid must read as
      // NOT_FOUND instead of aborting in Postgres (22P02 → 500).
      const acceptance = isUuid(input.id)
        ? await ctx.serverDB.query.acceptances.findFirst({
            where: eq(acceptances.id, input.id),
          })
        : undefined;
      if (!acceptance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
      }

      const isOwner = Boolean(ctx.userId) && ctx.userId === acceptance.userId;
      // The viewer's membership in the acceptance's OWN workspace — not their
      // currently-active one, which may be a different workspace entirely.
      const member =
        !isOwner && ctx.userId && acceptance.workspaceId
          ? await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
              acceptance.workspaceId,
              ctx.userId,
            )
          : undefined;

      const canRead = isOwner || acceptance.visibility === 'public' || Boolean(member);
      if (!canRead) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
      }

      // The one rule the write path enforces — same helper, so the page can
      // never advertise an action the mutation would refuse.
      const canReview = await canManageAcceptance(ctx, acceptance);

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
      // What each round actually spent. Owner-only: cost is the author's
      // operating detail, not something a shared link should expose.
      // `isOwner` already implies a signed-in viewer; the explicit id check is
      // what narrows it for the model, which is owner-scoped by construction.
      const usageByOperation =
        isOwner && ctx.userId
          ? await new AgentOperationModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined)
              .findUsageByOperations(
                runs.flatMap((run) => (run.operationId ? [run.operationId] : [])),
              )
              .catch(() => new Map<string, { cost: number; tokens: number }>())
          : new Map<string, { cost: number; tokens: number }>();
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
        return {
          report: reportsByRun.get(run.id) ?? null,
          run: publicRun,
          usage: (run.operationId ? usageByOperation.get(run.operationId) : undefined) ?? null,
        };
      });
      const latestReport = [...rounds].reverse().find((r) => r.report)?.report ?? null;

      // The authoring conversation (agent + topic), resolved for the header —
      // owner-only, same redaction rule as `run.metadata.origin`.
      const origin = isOwner ? await ownerService.resolveOrigin(runs) : null;

      const currentRoundIndex = runs.at(-1)?.roundIndex ?? 0;
      const resultsById = new Map(results.map((result) => [result.id, result]));

      // Automated proposals are the reviewer's working state, not published
      // content — a shared acceptance URL (the whole point of `public`
      // visibility) must not show visitors "an AI thinks this is broken".
      // Scoped to whoever may REVIEW, not to the creator: the predict button is
      // gated the same way, and a reviewer who can spend the model budget but
      // never receives a `predictionStatus` polls until it times out, then
      // reports the work as still running after it finished.
      const predictions = canReview
        ? await new VerifyReviewPredictionModel(
            ctx.serverDB,
            acceptance.userId,
            acceptance.workspaceId ?? undefined,
          ).listByRuns(runs.map((run) => run.id))
        : [];
      // Keyed by the concrete check RESULT, never by the union row's id. The
      // union exposes `sourceCriterionId ?? checkItemId` as `check.id` so a
      // renamed check folds across rounds — but a prediction is stored against
      // the result it judged. Keying on the logical id silently misses every
      // plan that uses a distinct snapshot id: generation reports success and
      // no card ever renders.
      const predictionByResult = new Map<string, (typeof predictions)[number]>();
      // Newest-first from the model, so the first write per check item wins and
      // later (older) rows are ignored.
      for (const prediction of predictions) {
        // Rows from an earlier pin (another model / prompt version) stay in
        // the table for the comparison set but are not this page's reviewer.
        if (!isCurrentReviewPrediction(prediction, REVIEW_PREDICT_MODEL_CONFIG)) continue;
        if (!predictionByResult.has(prediction.checkResultId)) {
          predictionByResult.set(prediction.checkResultId, prediction);
        }
      }

      return {
        acceptance,
        canReview,
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
          const prediction = check.result ? predictionByResult.get(check.result.id) : undefined;
          // A STALE review is last round's rejection carried forward as history;
          // THIS round's result is undecided. Treating it as a current verdict
          // hid the proposal on exactly the repair round where the reviewer has
          // to judge again.
          const settled = Boolean(userReview && !userReview.stale);
          return {
            ...check,
            evidence: check.result ? (evidenceByResult.get(check.result.id) ?? []) : [],
            prediction:
              prediction && shouldSurfaceProposal(prediction, settled) ? prediction : null,
            // The card above is gated to actionable rejects, but the FACT that
            // the predictor finished with this check must stay visible: an
            // `accept`, a skip and an error all render no card, and without
            // this the predict button's poll cannot tell "still running" from
            // "reviewed, nothing to say" — it spins to timeout on a clean bill.
            predictionStatus: prediction?.status ?? null,
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

  /**
   * Recent acceptances (with subject headers), newest first — list panel + CLI.
   *
   * `limit` is capped rather than open: the read resolves each row's subject
   * title one by one, so an unbounded window would fan out. The merge picker
   * asks for the wide end because a target it cannot list is a target the user
   * cannot merge into.
   */
  list: acceptanceProcedure
    .input(
      z
        .object({
          filter: z.enum(['active', 'all', 'completed']).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          q: z.string().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => ctx.acceptanceService.listWithSubjects(input)),

  /**
   * One keyset page of the same feed — what the list panel scrolls.
   *
   * Speaks the same `filter` vocabulary as `list`, applied in the query, so a
   * page of "in progress" is a full page of in-progress rows. There is no
   * paged search on purpose: a title search must span the whole owned set,
   * which `list` already does — the panel asks that one while a query is live.
   */
  listPage: acceptanceProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          filter: z.enum(['active', 'all', 'completed']).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) =>
      ctx.acceptanceService.listPageWithSubjects({
        cursor: input?.cursor,
        filter: input?.filter,
        limit: input?.limit,
      }),
    ),

  /**
   * Fold one acceptance into another: the source's verification rounds (and
   * with them its checks, verdicts and evidence) re-chain onto the target, and
   * the source entry is deleted.
   *
   * Both sides are creator-scoped like every other verify write — a merge
   * rewrites BOTH aggregates, so a workspace member must not be able to fold
   * another member's acceptance into (or out of) their own.
   */
  merge: acceptanceWriteProcedure
    .input(z.object({ sourceId: z.string(), targetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // A merge rewrites BOTH aggregates, so both have to authorize; the source
      // owns the rows that move, so its scope is the one the write runs in.
      const { acceptance: source, service } = await resolveAcceptanceForWrite(ctx, input.sourceId);
      const { acceptance: target } = await resolveAcceptanceForWrite(ctx, input.targetId);

      try {
        return await service.merge(source.id, target.id);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to merge acceptance',
        });
      }
    }),

  /**
   * Acceptance status for a known set of subjects, in one read.
   *
   * `list` is recency-capped and spans every subject type, so a list surface
   * that derived per-row state from it would silently mis-read any subject
   * pushed past the cap. This answers about exactly the subjects asked for.
   */
  listStatusesBySubjects: acceptanceProcedure
    .input(
      z.object({
        subjectIds: z.array(z.string()).max(200),
        subjectType: subjectTypeSchema,
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.acceptanceService.acceptanceModel.listStatusesBySubjects(
        input.subjectType,
        input.subjectIds,
      ),
    ),

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
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      // The feedback is addressed to the CURRENT round and lives on its run's
      // decision detail — the same home as the round's terminal accept/reject
      // note, so staleness falls out of the round chain and a deleted round
      // takes its feedback along.
      const { runs } = await service.loadRounds(acceptance.id);
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
          /**
           * Which of the three jobs a reject is doing. Optional so older
           * clients keep working — and left genuinely absent rather than
           * defaulted, because guessing `unmet` here would recreate exactly the
           * conflated label the split exists to remove.
           */
          rejectIntent: z.enum(acceptanceRejectIntents).optional(),
          /** Set when the reviewer was responding to a model proposal. */
          proposal: z
            .object({
              adjudication: z.enum(reviewAdjudications),
              edit: z.enum(reviewProposalEdits).optional(),
              predictionId: z.string(),
            })
            .optional(),
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
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      try {
        const result = await service.reviewChecks(acceptance.id, {
          action: input.action,
          annotations: input.annotations,
          checkItemIds: input.checkItemIds,
          comment: input.comment?.trim() || undefined,
          fileIds: input.fileIds,
          proposal: input.proposal,
          rejectIntent: input.rejectIntent,
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to review checks',
        });
      }
    }),

  /**
   * Answer a model proposal without ruling on the check itself.
   *
   * `not-an-issue` and `misidentified` are answers to the MODEL, not to the
   * delivery — the check stays pending and the reviewer still has to judge it.
   * That is why this writes to the prediction row rather than going through
   * `reviewChecks`: routing a dismissal through the review path would stamp a
   * `user_decision` the reviewer never made.
   *
   * The `confirmed` case does not come here — it rides along with the reject in
   * `reviewChecks`, where the edit diff is available.
   */
  adjudicateProposal: acceptanceWriteProcedure
    .input(
      z.object({
        adjudication: z.enum(['not-an-issue', 'misidentified'] as const),
        id: z.string(),
        predictionId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Authorization only — the prediction rows are read through their own
      // owner-scoped model just below.
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);

      const model = new VerifyReviewPredictionModel(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );
      const prediction = await model.findById(input.predictionId);
      if (!prediction) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      }

      await model.adjudicate(prediction.id, { adjudication: input.adjudication });
      return { success: true };
    }),

  /**
   * Generate automated review proposals for the checks still awaiting a
   * verdict in this acceptance.
   *
   * An explicit mutation rather than a side effect of `getBundle`: reading a
   * report must not spend model budget, and the reviewer needs to be able to
   * ask for proposals again after a new round lands.
   */
  predictReviews: acceptanceWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      const { results, runs } = await service.loadRounds(acceptance.id);
      const resultsByRun = new Map<string, typeof results>();
      for (const result of results) {
        const bucket = resultsByRun.get(result.verifyRunId!) ?? [];
        bucket.push(result);
        resultsByRun.set(result.verifyRunId!, bucket);
      }
      const checks = buildAcceptanceCheckUnion(
        runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
      );

      // Pinned, never the verifier's own model: the predictor reads screenshots,
      // and a text-only verifier model silently judges frames it cannot see.
      const modelConfig = REVIEW_PREDICT_MODEL_CONFIG;

      const predictor = new VerifyReviewPredictorService(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );

      // Only checks the reviewer has not already ruled on. Re-judging a settled
      // check spends budget to argue with a decision that is already made.
      const pending = checks.filter((check) => check.result && !check.result.userDecision);

      // Forget the previous batch's unanswered rows BEFORE responding: the
      // client waits for every queued check to carry a recorded attempt, and
      // with the old rows still in place that condition holds on the first
      // poll — before a single new judgement has landed.
      await predictor.resetPending(
        pending.map((check) => check.result!.id),
        modelConfig,
      );

      // Dispatched AFTER the response, with a ceiling on how many model calls
      // are open at once.
      //
      // Awaiting the fan-out inline could not survive real data: each check is
      // a 10-25s multimodal generation, so a thirty-check acceptance ran well
      // past any gateway timeout and the reviewer lost every proposal the run
      // had already paid for. The ceiling is the other half — an unbounded
      // `Promise.all` opened one generation per check simultaneously, which is
      // how a single click turns into a provider rate-limit burst.
      //
      // The client polls the bundle for the cards to appear; a failed
      // individual prediction is recorded as an `errored` row inside `predict`
      // rather than thrown, so one bad check cannot abort its neighbours.
      after(async () => {
        try {
          await mapWithConcurrency(pending, REVIEW_PREDICT_CONCURRENCY, (check) =>
            predictor.predict({
              checkResultId: check.result!.id,
              instructionDocumentId: check.planItem?.documentId,
              modelConfig,
              requirement: acceptance.requirement,
              surface: check.surface,
            }),
          );
        } catch (error) {
          console.error('[acceptance] review prediction batch failed', error);
        }
      });

      return { queued: pending.length };
    }),

  /**
   * Flip who can read the acceptance beyond its creator. Creation defaults are
   * scope-dependent (personal → public, workspace → private); this is the
   * deliberate override.
   */
  setVisibility: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), visibility: z.enum(acceptanceVisibilities) }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      const updated = await service.acceptanceModel.update(acceptance.id, {
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
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      if (acceptance.status !== 'delivered' && acceptance.status !== 'errored') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Only a settled acceptance can be sent back (status: ${acceptance.status})`,
        });
      }
      return service.acceptanceModel.updateStatus(acceptance.id, 'repairing');
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
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      return service.reject(acceptance.id, input.comment);
    }),

  /**
   * Rename the acceptance in the caller's list — a display-title override kept
   * on the aggregate's metadata. The subject's own title (the source topic /
   * task / document) is left untouched, so renaming the sidebar entry never
   * mutates the origin conversation.
   */
  rename: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      return service.acceptanceModel.update(acceptance.id, {
        metadata: { ...acceptance.metadata, title: input.title },
      });
    }),

  /**
   * File the acceptance under a project (or take it out of one) from the list.
   * Only the grouping pointer moves: the delivery, its rounds and its subject
   * are untouched, so this is reversible and never rewrites history.
   *
   * The bar is READABLE, not manageable: a delivery may be filed under any
   * project the caller can see — the same set the list already groups by — so
   * a workspace member is not blocked from filing under a teammate's project.
   */
  setProject: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), projectId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      if (input.projectId) {
        const project = await new ProjectModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).findById(input.projectId);
        if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      await service.acceptanceModel.update(acceptance.id, {
        projectId: input.projectId,
      });
      return { success: true };
    }),

  /**
   * The multi-select twin of `setProject`: file a whole selection under one
   * project (or take it out of any) in one action.
   *
   * The target project is validated ONCE, up front — a missing project fails
   * the sweep wholesale, because every row was headed to the same place. Rows
   * keep the batch contract — one the caller cannot write lands in `failedIds`
   * instead of voiding the rest — but unlike the status sweep there is no
   * per-row recomputation, so the whole move is three bounded queries (resolve,
   * authorize, bulk update) rather than a round trip per row.
   */
  setProjectBatch: acceptanceWriteProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(ACCEPTANCE_BATCH_LIMIT),
        projectId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) {
        const project = await new ProjectModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).findById(input.projectId);
        if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const ids = [...new Set(input.ids)];
      const resolvableIds = ids.filter((id) => isUuid(id));
      const rows =
        resolvableIds.length > 0
          ? await ctx.serverDB.query.acceptances.findMany({
              columns: { id: true, userId: true, workspaceId: true },
              where: inArray(acceptances.id, resolvableIds),
            })
          : [];
      const manageable = await filterManageableAcceptances(ctx, rows);

      let updatedIds: string[] = [];
      if (manageable.length > 0) {
        updatedIds = (
          await ctx.serverDB
            .update(acceptances)
            .set({ projectId: input.projectId })
            .where(
              inArray(
                acceptances.id,
                manageable.map((row) => row.id),
              ),
            )
            .returning({ id: acceptances.id })
        ).map((row) => row.id);
      }

      const updatedSet = new Set(updatedIds);
      return { failedIds: ids.filter((id) => !updatedSet.has(id)), updated: updatedIds.length };
    }),

  /**
   * Manually move the acceptance's user-facing lifecycle state from the list —
   * an owner override (mark accepted / closed / rejected, or reopen for another look).
   */
  updateStatus: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), status: acceptanceStatusOverrideSchema }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      try {
        await applyAcceptanceStatus(service, acceptance, input.status);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to update status',
        });
      }
      return { success: true };
    }),

  /**
   * The multi-select twin of `updateStatus`: sweep a backlog of deliveries into
   * accepted / closed in one action.
   *
   * A row that cannot take the transition (mid-verification, so undecidable;
   * or someone else's row in a workspace) is COLLECTED, not thrown: one
   * ineligible row must not void the other forty the user just swept, and the
   * caller reports what actually landed. Sequential on purpose — each accept
   * recomputes the aggregate and stamps its round, and a sweep is a background
   * chore, not a latency-critical path.
   */
  updateStatusBatch: acceptanceWriteProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(ACCEPTANCE_BATCH_LIMIT),
        status: acceptanceStatusOverrideSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const failedIds: string[] = [];
      let updated = 0;

      for (const id of new Set(input.ids)) {
        try {
          const { acceptance, service } = await resolveAcceptanceForWrite(ctx, id);
          await applyAcceptanceStatus(service, acceptance, input.status);
          updated += 1;
        } catch (error) {
          console.error('[acceptance] batch status update failed for %s', id, error);
          failedIds.push(id);
        }
      }

      return { failedIds, updated };
    }),

  /**
   * Delete the acceptance aggregate. Its chained verify runs detach
   * (acceptance_id → null via the FK's `set null`) rather than cascade-delete,
   * so the individual round reports stay reachable; only the grouping goes.
   */
  remove: acceptanceWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      await service.acceptanceModel.delete(acceptance.id);
      return { success: true };
    }),

  /**
   * The multi-select twin of `remove`. Like the batch status sweep, a row the
   * caller may not delete is collected rather than thrown, so the rest of the
   * selection still goes.
   */
  removeBatch: acceptanceWriteProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(ACCEPTANCE_BATCH_LIMIT) }))
    .mutation(async ({ ctx, input }) => {
      const failedIds: string[] = [];
      let deleted = 0;

      for (const id of new Set(input.ids)) {
        try {
          const { acceptance, service } = await resolveAcceptanceForWrite(ctx, id);
          await service.acceptanceModel.delete(acceptance.id);
          deleted += 1;
        } catch (error) {
          console.error('[acceptance] batch delete failed for %s', id, error);
          failedIds.push(id);
        }
      }

      return { deleted, failedIds };
    }),
});
