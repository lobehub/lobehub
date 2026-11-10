import { nanoid } from '@lobechat/utils';
import { z } from 'zod';

import { holdAgentRunFee, settleAgentRunFee } from '@/business/server/agent-run/runFee';
import { router } from '@/libs/trpc/lambda';

import { resolveHeteroTopicWorkspace } from './guards';
import { aiAgentBaseProcedure } from './procedures';

/**
 * Fee ids this router mints. The start time is part of the id, so `finish`
 * measures the run's duration on the server instead of trusting the client,
 * and the prefix keeps `finish` from settling the fee of a server-dispatched
 * run (whose holder is its operation id).
 */
const LOCAL_HETERO_RUN_FEE_ID = /^local_hetero_(\d+)_[\w-]+$/;

const mintLocalHeteroRunFeeId = () => `local_hetero_${Date.now()}_${nanoid()}`;

/**
 * Run fee for an external agent (Claude Code, Codex, …) Desktop spawns on the
 * user's own machine. That run never passes through `execAgent`, so Desktop
 * reports it here: `begin` before spawning the CLI, `finish` once it ends.
 *
 * The caller decides which runs report (the same exemptions as
 * `shouldHoldRunFee`: continuations and sub-agents do not); Workspace runs are
 * exempt here, resolved from the topic rather than taken from the client.
 * A client that never calls `finish` leaves the hold to expire on its own.
 */
export const localHeteroRunFeeRouter = router({
  /**
   * Holds the fee. A deployment that refuses an unfunded fee throws, and
   * Desktop then does not start the CLI. Returns `feeId: null` when the run
   * carries no fee.
   */
  beginLocalHeteroRunFee: aiAgentBaseProcedure
    .input(z.object({ topicId: z.string().min(1).optional() }))
    .mutation(async ({ input, ctx }) => {
      const workspaceId = input.topicId
        ? await resolveHeteroTopicWorkspace({
            db: ctx.serverDB,
            requestedWorkspaceId: ctx.workspaceId,
            topicId: input.topicId,
            userId: ctx.userId,
          })
        : ctx.workspaceId;
      if (workspaceId) return { feeId: null };

      const feeId = mintLocalHeteroRunFeeId();
      await holdAgentRunFee({ holderId: feeId, userId: ctx.userId });
      return { feeId };
    }),

  /** Charges or gives back the fee by the run's end reason, as `settleAgentRunFee` rules. */
  finishLocalHeteroRunFee: aiAgentBaseProcedure
    .input(
      z.object({
        /**
         * How long the run lasted when it ended, as Desktop saw it. Cleanup after a
         * stop (persisting, closing the CLI) can take seconds, so the time of this
         * call overstates a stopped run. It can only shorten the duration the
         * server measures.
         */
        durationMs: z.number().int().nonnegative().optional(),
        feeId: z.string().regex(LOCAL_HETERO_RUN_FEE_ID),
        reason: z.enum(['done', 'error', 'interrupted']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const startedAt = Number(LOCAL_HETERO_RUN_FEE_ID.exec(input.feeId)![1]);
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      await settleAgentRunFee({
        durationMs: Math.min(elapsedMs, input.durationMs ?? elapsedMs),
        operationId: input.feeId,
        reason: input.reason,
        userId: ctx.userId,
      });
      return { success: true as const };
    }),
});
