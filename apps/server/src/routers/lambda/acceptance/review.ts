import {
  acceptanceCheckReviewActions,
  acceptanceRejectIntents,
  reviewAdjudications,
  reviewProposalEdits,
} from '@lobechat/const/verify';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { VerifyReviewPredictionModel } from '@/database/models/verifyReviewPrediction';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { notifyAcceptance } from '@/server/services/acceptanceReview/events';
import {
  buildAcceptanceCheckUnion,
  mapWithConcurrency,
  REVIEW_PREDICT_CONCURRENCY,
  REVIEW_PREDICT_MODEL_CONFIG,
  VerifyReviewPredictorService,
} from '@/server/services/verify';
import { after } from '@/server/utils/scheduleAfterResponse';

import {
  type AcceptanceRepairDispatch,
  dispatchAcceptanceRepair,
} from '../_helpers/acceptanceRepairDispatch';
import { settleGoalSignOff } from '../_helpers/acceptanceStatus';
import * as goalGate from '../_helpers/goalGateAcceptance';
import { acceptanceWriteProcedure, resolveAcceptanceForWrite } from './procedures';
import { reviewAnnotationsSchema } from './schemas';

export const reviewProcedures = {
  regroupChecks: acceptanceWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int().nonnegative(),
        groups: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              checkItemIds: z.array(z.string().min(1)).min(1).max(1000),
            }),
          )
          .max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { service } = await resolveAcceptanceForWrite(ctx, input.id);
      return service.regroupChecks(input.id, input.groups, input.expectedVersion);
    }),
  /**
   * The user accepts the delivery — the terminal business event that closes
   * the acceptance lifecycle. The verifier's verdict is a recommendation; this
   * click is the event (a failed/uncertain round can still be accepted, which
   * means the user knowingly takes it with its exceptions).
   */
  accept: acceptanceWriteProcedure
    .input(goalGate.gateDecisionInput.extend({ comment: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      const accepted = await goalGate.withGoalGateAnswer(
        ctx.serverDB,
        service,
        acceptance,
        'release',
        { comment: input.comment, roundId: input.roundId },
        () => service.accept(acceptance.id, input.comment),
      );
      // Signed where it lives — the inbox stops asking for the same sign-off.
      await settleGoalSignOff(ctx.serverDB, acceptance, 'signOff', input.comment);
      return accepted;
    }),
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
          annotations: reviewAnnotationsSchema,
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
      await service.acceptanceModel.updateStatus(acceptance.id, 'repairing');
      notifyAcceptance(acceptance.id, 'session', ctx.userId);
    }),
  /**
   * The user rejects the delivery. An optional comment is a re-tasking input: it is
   * recorded on the current round's decision and seeds the next repair/verify
   * round. When the rounds name an authoring conversation, the delivery is sent
   * straight back to that agent and the acceptance moves to `repairing`; the
   * outcome rides on `repairDispatch` so every surface (UI, CLI, external
   * callers) reports the same thing. Without one the caller hands the repair
   * prompt over itself.
   */
  reject: acceptanceWriteProcedure
    .input(
      goalGate.gateDecisionInput.extend({
        comment: z.string().trim().max(2000).optional(),
        /**
         * Send the delivery back to the agent that authored it (default). Pass
         * `false` to only record the decision — the caller hands the repair
         * prompt over itself.
         */
        dispatch: z.boolean().optional(),
      }),
    )
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<AcceptanceItem & { repairDispatch: AcceptanceRepairDispatch }> => {
        const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

        const comment = input.comment || undefined;
        const rejected = await goalGate.withGoalGateAnswer(
          ctx.serverDB,
          service,
          acceptance,
          'revise',
          { comment, roundId: input.roundId },
          () => service.reject(acceptance.id, comment),
        );
        await settleGoalSignOff(
          ctx.serverDB,
          acceptance,
          'requestChanges',
          input.comment || undefined,
        );
        // A gate's revision is carried out by the goal: its main Agent rewrites the plan.
        if (input.dispatch === false || acceptance.subjectType === 'goal_gate') {
          return { ...rejected, repairDispatch: { dispatched: false, reason: 'skipped' } };
        }

        const repairDispatch = await dispatchAcceptanceRepair(
          ctx,
          service,
          acceptance,
          input.comment || undefined,
        );
        if (!repairDispatch.dispatched) return { ...rejected, repairDispatch };

        const current = await service.acceptanceModel.findById(acceptance.id);
        return { ...(current ?? rejected), repairDispatch };
      },
    ),
};
