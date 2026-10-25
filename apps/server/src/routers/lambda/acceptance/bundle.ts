import type { AcceptanceAttachment } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { AcceptanceCommentModel } from '@/database/models/acceptanceComment';
import { AcceptanceFlowModel } from '@/database/models/acceptanceFlow';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ScmChangeRequestModel } from '@/database/models/scm';
import { VerifyReviewPredictionModel } from '@/database/models/verifyReviewPrediction';
import { users } from '@/database/schemas';
import { acceptances } from '@/database/schemas/verify';
import { isUuid } from '@/database/utils/uuid';
import { router } from '@/libs/trpc/lambda';
import {
  AcceptanceService,
  buildAcceptanceCheckUnion,
  buildCheckReviewOverlay,
  createEvidenceFileResolver,
  isCurrentReviewPrediction,
  REVIEW_PREDICT_MODEL_CONFIG,
  shouldSurfaceProposal,
} from '@/server/services/verify';
import { listAcceptancePullRequests } from '@/server/services/verify/acceptancePullRequests';

import { canManageAcceptance } from '../_helpers/acceptanceWriteScope';
import { canReadAcceptance, publicAcceptanceProcedure } from './procedures';

/** Cap on concurrent evidence/attachment file lookups while building one bundle. */
const FILE_META_RESOLVE_CONCURRENCY = 5;

export const bundleRouter = router({
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
      if (!isOwner && !(await canReadAcceptance(ctx, acceptance))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
      }

      // The one rule the write path enforces — same helper, so the page can
      // never advertise an action the mutation would refuse.
      const canReview = await canManageAcceptance(ctx, acceptance);
      // A reader a decider granted edit-collaboration to may send the delivery
      // back — the same widening `resolveAcceptanceForReject` applies to the
      // write — and talk to the agent bound to it. The owner holds both already.
      const collaborationGranted =
        !isOwner &&
        Boolean(ctx.userId) &&
        (await new AcceptanceCommentModel(ctx.serverDB).hasAccessGrant(
          acceptance.id,
          ctx.userId!,
          'collaborate',
        ));

      // Sub-reads (rounds / results / evidence) are ownership-scoped models, so
      // read them AS the aggregate's owner — same pattern as the evidence file
      // resolver. The visibility gate above is the actual access decision.
      const ownerService = new AcceptanceService(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );

      const [subject, { evidence, reports, results, runs }, authorRows, changeRequests] =
        await Promise.all([
          ownerService.resolveSubject(acceptance),
          ownerService.loadRounds(acceptance.id),
          // Who delivered this, the way a pull request names its author. A
          // shared link lands on someone else's record, and a record with no
          // name on it reads as nobody's.
          ctx.serverDB
            .select({
              avatar: users.avatar,
              fullName: users.fullName,
              id: users.id,
              username: users.username,
            })
            .from(users)
            .where(eq(users.id, acceptance.userId)),
          // Provider-verified PRs that deliver it. Owned by the acceptance, not
          // by a round, so one opened after the last round still shows.
          ScmChangeRequestModel.listByAcceptance(ctx.serverDB, acceptance.id),
        ]);
      const author = authorRows[0] ?? null;

      const flowData = await new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).list(
        acceptance.id,
      );
      const flowResultIds = new Set(
        flowData.flatMap((flow) =>
          flow.versions.flatMap((version) =>
            version.runs.flatMap((run) => run.attempts.map((attempt) => attempt.checkResultId)),
          ),
        ),
      );
      const resultsByRun = new Map<string, typeof results>();
      for (const result of results) {
        const key = result.verifyRunId!;
        const bucket = resultsByRun.get(key) ?? [];
        bucket.push(result);
        resultsByRun.set(key, bucket);
      }

      const checks = buildAcceptanceCheckUnion(
        runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
        acceptance.metadata?.checkGrouping?.groups,
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
      const enriched = await pMap(
        evidence.filter(
          (e) => timelineResultIds.has(e.checkResultId) || flowResultIds.has(e.checkResultId),
        ),
        async (e) => ({ ...e, ...(await resolveFileMeta(e.fileId ?? null)) }),
        { concurrency: FILE_META_RESOLVE_CONCURRENCY },
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
      const attachmentIds = new Set<string>(
        flowData.flatMap((flow) =>
          flow.versions.flatMap((version) =>
            version.runs.flatMap((run) =>
              run.attempts.flatMap((attempt) => attempt.reviewDetail?.fileIds ?? []),
            ),
          ),
        ),
      );
      for (const result of results)
        for (const id of result.userDecisionDetail?.fileIds ?? []) attachmentIds.add(id);
      for (const run of runs)
        for (const entry of run.decisionDetail?.groupFeedback ?? [])
          for (const id of entry.fileIds ?? []) attachmentIds.add(id);
      const attachmentById = new Map<string, AcceptanceAttachment>();
      await pMap(
        attachmentIds,
        async (id) => {
          const meta = await resolveFileMeta(id);
          attachmentById.set(id, { id, name: meta.fileName ?? undefined, url: meta.fileUrl });
        },
        { concurrency: FILE_META_RESOLVE_CONCURRENCY },
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
      // A grantee's reject runs the owner's agent, so they need to know whether
      // there is one to run — as a yes/no, never the private topic it names.
      // A collaborator's reject and messages run the owner's agent, so they need
      // to know there is one, and how to show it — the agent's face and the
      // topic's title, never the private ids behind them.
      const collaboratorOrigin = collaborationGranted
        ? await ownerService.resolveOrigin(runs)
        : null;
      const repairDispatchAvailable = isOwner
        ? Boolean(origin?.topic)
        : Boolean(collaboratorOrigin?.topic);
      const collaboration =
        collaboratorOrigin?.topic && collaboratorOrigin.agent
          ? {
              agent: {
                avatar: collaboratorOrigin.agent.avatar,
                backgroundColor: collaboratorOrigin.agent.backgroundColor,
                title: collaboratorOrigin.agent.title,
              },
              topicTitle: collaboratorOrigin.topic.title,
            }
          : null;

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
      // Goal reviews may use the owner's configured model. Their persisted ids
      // identify the actual automatic decision without admitting unrelated rows.
      const automaticPredictionIds = new Set(
        runs.flatMap((run) => run.metadata?.goalReview?.predictionIds ?? []),
      );
      // Newest-first from the model, so the first write per check item wins and
      // later (older) rows are ignored.
      for (const prediction of predictions) {
        // Rows from an earlier pin (another model / prompt version) stay in
        // the table for the comparison set but are not this page's reviewer.
        if (
          !isCurrentReviewPrediction(
            prediction,
            REVIEW_PREDICT_MODEL_CONFIG,
            automaticPredictionIds,
          )
        )
          continue;
        if (!predictionByResult.has(prediction.checkResultId)) {
          predictionByResult.set(prediction.checkResultId, prediction);
        }
      }

      return {
        author,
        pullRequests: listAcceptancePullRequests(changeRequests, acceptance.metadata?.pullRequests),
        flows: flowData.map((flow) => ({
          ...flow,
          versions: flow.versions.map((version) => ({
            ...version,
            runs: version.runs.map((run) => ({
              ...run,
              attempts: run.attempts.map((attempt) => ({
                ...attempt,
                reviewAttachments: toAttachments(attempt.reviewDetail?.fileIds),
                evidence: evidenceByResult.get(attempt.checkResultId) ?? [],
              })),
            })),
          })),
        })),
        acceptance,
        canCollaborate: collaborationGranted,
        canReject: canReview || collaborationGranted,
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
        collaboration,
        latestReport,
        origin,
        repairDispatchAvailable,
        rounds,
        subject,
      };
    }),
});
