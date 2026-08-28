import { isHeterogeneousAgentConfig } from '@lobechat/const';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { AgentShareModel } from '@/database/models/agentShare';
import { VISITOR_TOPIC_PAGE_SIZE } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AiAgentService } from '@/server/services/aiAgent';
import { createOwnerPrincipal } from '@/server/services/executionPrincipal';
import { after } from '@/server/utils/scheduleAfterResponse';

import { assertAgentShareCreationEnabled } from './_helpers/agentShareFeatureGate';

const agentIdInput = z.object({ agentId: z.string().trim().min(1) }).strict();

export const agentShareConfigSchema = z
  .object({
    allowReadMemory: z.boolean().optional(),
    enabledToolIds: z.array(z.string().trim().min(1)).optional(),
    filePermissionConfig: z
      .object({
        agentFiles: z.enum(['none', 'read']).optional(),
        knowledgeBase: z.enum(['none', 'read']).optional(),
        uploadAllowed: z.boolean().optional(),
      })
      .strict()
      .optional(),
    // Bounded by the visitor topic list page size (`TopicModel.queryVisitorShareTopics`),
    // which has no cursor: a higher cap would let a visitor create topics that
    // the list can never show again.
    maxTopicsPerVisitor: z.number().int().positive().max(VISITOR_TOPIC_PAGE_SIZE),
    maxTurnsPerTopic: z.number().int().positive(),
  })
  .strict();

export const agentShareConfigPatchSchema = agentShareConfigSchema
  .partial()
  .refine((config) => Object.keys(config).length > 0, 'Config patch cannot be empty');

const agentShareProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      agentShareModel: new AgentShareModel(ctx.serverDB, ctx.userId),
    },
  });
});

/** `AgentShareModel.updateConfig` / `updateVisibility` / `deleteByAgentId` all return this shape — see `ShareMutationResult`'s JSDoc there. */
interface ShareMutationResult<T> {
  revocationGeneration?: number;
  share: T | null;
}

const requireShare = <T>({
  revocationGeneration,
  share,
}: ShareMutationResult<T>): {
  revocationGeneration?: number;
  share: T;
} => {
  if (!share) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent share not found' });
  }

  return { revocationGeneration, share };
};

/**
 * Reject enabling/publishing a share for a heterogeneous (Claude Code / Codex /
 * …) agent. `AiAgentService.execAgent` fail-closes every visitor run against
 * such agents with `ShareHeterogeneousAgentUnsupported` (see
 * apps/server/src/services/aiAgent/index.ts), so a link that reaches this
 * state looks live in the owner's settings but breaks on the recipient's very
 * first message. Reusing the same classification the runtime uses — rather
 * than re-deriving it — keeps this gate and the execution gate from drifting
 * apart. Checked here (in the router, not `AgentShareModel`) so it composes
 * cleanly with that model's own hardening work happening in parallel.
 */
const assertShareableAgent = async (agentModel: AgentModel, agentId: string) => {
  const agent = await agentModel.getAgentConfigById(agentId);

  if (isHeterogeneousAgentConfig(agent)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
    });
  }
};

/**
 * Interrupt every in-flight visitor run on a shared agent, scheduled with
 * `after()` so it never delays the revocation response.
 *
 * Called AFTER the revocation write below has already committed (both
 * mutations run inside `AgentShareModel`'s own `FOR UPDATE` transaction, see
 * `withOwnedPersonalAgentLock`). `interruptActiveShareRuns` touches the
 * runtime — device gateway calls, `agentRuntimeService.interruptOperation`,
 * operation/thread row writes — which are side effects that must never fire
 * on a rollback, so they cannot run inside that transaction. Best-effort: a
 * visitor's Stop button is already gone the instant the share row commits
 * (`shareChat.interruptTask` re-resolves the share and gets `FORBIDDEN`), so
 * this is the only thing left to stop an already-running operation instead
 * of letting it keep spending the creator's share budget until it finishes
 * on its own.
 *
 * `revocationGeneration` MUST be the exact value `AgentShareModel` bumped
 * `agentShareGenerations` to as part of the SAME write this schedules after
 * — never a value re-read later, after this `after()` callback has already
 * been queued. Re-reading "the current generation" at callback time would
 * reopen the exact hole this closes: an owner could revoke, then republish
 * (bumping nothing — publishing never bumps the generation) before this
 * callback runs, and a re-read would then see the SAME generation the
 * republish's fresh reservations were staked at, sweeping them up as if they
 * predated the revocation they didn't. Capturing the cutoff at write time and
 * passing it through closed-over is what makes `revokeReservations` /
 * `findActiveVisitorRunTopics`'s `generation < revocationGeneration` filter
 * correct regardless of how late this callback actually runs. See
 * `agentShareGenerations`'s JSDoc (`packages/database/src/schemas/agentShare.ts`).
 */
const interruptActiveShareRunsAfterResponse = (
  serverDB: ConstructorParameters<typeof AiAgentService>[0],
  ownerId: string,
  agentId: string,
  revocationGeneration: number,
) => {
  after(() =>
    new AiAgentService(serverDB, createOwnerPrincipal(ownerId))
      .interruptActiveShareRuns(agentId, revocationGeneration)
      .catch((error) => console.error('[agentShare] interruptActiveShareRuns failed', error)),
  );
};

export const agentShareRouter = router({
  disableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    const { revocationGeneration, share } = requireShare(
      await ctx.agentShareModel.deleteByAgentId(input.agentId),
    );
    // `deleteByAgentId` always bumps the generation (disabling unconditionally
    // revokes), so `revocationGeneration` is always defined here.
    interruptActiveShareRunsAfterResponse(
      ctx.serverDB,
      ctx.userId,
      input.agentId,
      revocationGeneration!,
    );
    return share;
  }),

  enableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    await assertAgentShareCreationEnabled(ctx.userId);
    await assertShareableAgent(ctx.agentModel, input.agentId);

    return ctx.agentShareModel.create(input.agentId);
  }),

  getShareStatus: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    return ctx.agentShareModel.getByAgentId(input.agentId);
  }),

  updateShareConfig: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          config: agentShareConfigPatchSchema,
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertAgentShareCreationEnabled(ctx.userId);

      const { revocationGeneration, share } = requireShare(
        await ctx.agentShareModel.updateConfig(input.agentId, input.config),
      );

      // `revocationGeneration` is only set when the merged patch actually
      // NARROWED a `link` share's grants (`AgentShareModel.isConfigTightening`)
      // — a purely additive/loosening patch, or any patch to a `private`
      // share, must not interrupt anything. See both methods' JSDoc for the
      // exact field-by-field tightening rules.
      if (revocationGeneration !== undefined) {
        interruptActiveShareRunsAfterResponse(
          ctx.serverDB,
          ctx.userId,
          input.agentId,
          revocationGeneration,
        );
      }

      return share;
    }),

  updateVisibility: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          visibility: z.enum(['private', 'link']),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      // Publishing (`link`) grows visitor access, so it passes the feature
      // gate; un-publishing (`private`) is a revoke and must always work, even
      // for a creator dropped from the grayscale whitelist.
      if (input.visibility === 'link') {
        await assertAgentShareCreationEnabled(ctx.userId);
      }

      // The authoritative heterogeneity check now lives in
      // `AgentShareModel.updateVisibility` itself, re-read from the Agent row
      // AFTER that model takes its row lock — see the JSDoc there for why a
      // pre-lock check here (the previous approach) could be bypassed by a
      // concurrent `AgentModel.updateConfig` write. Not duplicated here to
      // avoid the two checks drifting apart.
      const { revocationGeneration, share } = requireShare(
        await ctx.agentShareModel.updateVisibility(input.agentId, input.visibility),
      );

      // Only `link` → `private` revokes visitor access (and is the only case
      // `updateVisibility` bumps the generation for); publishing (`link`)
      // never needs to interrupt anything.
      if (input.visibility === 'private') {
        interruptActiveShareRunsAfterResponse(
          ctx.serverDB,
          ctx.userId,
          input.agentId,
          revocationGeneration!,
        );
      }

      return share;
    }),
});

export type AgentShareConfigInput = z.infer<typeof agentShareConfigSchema>;
export type AgentShareConfigPatchInput = z.infer<typeof agentShareConfigPatchSchema>;
export type AgentShareRouter = typeof agentShareRouter;
