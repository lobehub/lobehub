import {
  chatTopicCreateMetadataSchema,
  chatTopicMetadataUpdateSchema,
  chatTopicStatusSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
} from '../_helpers/conversationResourceGuard';
import { resolveContext } from '../_helpers/resolveContext';
import { assertCreatorTopicTargets } from '../_helpers/shareVisitorTargetGuard';
import { guardCtx, topicProcedure } from './procedures';

export const updateProcedures = {
  updateTopic: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          agentId: z.string().optional(),
          completedAt: z.date().nullish(),
          favorite: z.boolean().optional(),
          historySummary: z.string().optional(),
          messages: z.array(z.string()).optional(),
          // The topic's pinned model (top-level columns) — written when the user
          // switches model while the topic is active (see updateTopicModel).
          // Nullish to match `Partial<ChatTopic>` whose model/provider are `string | null`.
          model: z.string().nullish(),
          provider: z.string().nullish(),
          sessionId: z.string().optional(),
          status: chatTopicStatusSchema.nullish(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Intentionally no creator/owner gate: shared topics are co-editable by
      // members (title/status/metadata); only delete/transfer is creator-scoped.
      // Co-editing still requires `use`-level General access on the agent —
      // view-only members are read-only.
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);
      const { agentId, ...restValue } = input.value;
      if (agentId) await assertCanUseConversationTargets(guardCtx(ctx), [{ agentId }]);

      // If agentId is provided, resolve to sessionId
      let resolvedSessionId = restValue.sessionId;
      if (agentId && !resolvedSessionId) {
        const resolved = await resolveContext(
          { agentId },
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        resolvedSessionId = resolved.sessionId ?? undefined;
      }

      return ctx.topicModel.update(input.id, { ...restValue, sessionId: resolvedSessionId });
    }),
  /**
   * Switch the topic's pinned model and its effort pin atomically — see
   * `TopicModel.updateModelPin`. Same co-editing rules as `updateTopic`.
   */
  updateTopicModel: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        metadata: chatTopicCreateMetadataSchema.optional(),
        model: z.string(),
        provider: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);

      const { id, ...value } = input;
      return ctx.topicModel.updateModelPin(id, value);
    }),
  updateTopicMetadata: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        metadata: chatTopicMetadataUpdateSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Intentionally no creator/owner gate: metadata follows the same
      // co-editable path as updateTopic (chat/tool flows write fields like
      // runningOperation on shared topics); only delete/transfer is gated.
      // Co-editing still requires `use`-level General access on the agent.
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);

      return ctx.topicModel.updateMetadata(input.id, input.metadata);
    }),
  batchMoveTopics: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        targetAgentId: z.string(),
        topicIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const rows = await ctx.topicModel.findOwnersByIds(input.topicIds);
      for (const userId of new Set(rows.map((row) => row.userId))) {
        assertWorkspaceRowManageable(ctx, userId, 'topic');
      }
      // Moving needs `use` on both the source conversations and the target agent.
      await assertCanUseTopicTargets(guardCtx(ctx), input.topicIds);
      await assertCanUseConversationTargets(guardCtx(ctx), [{ agentId: input.targetAgentId }]);
      // Moving a visitor topic re-parents it off the share and strands the
      // visitor outside the senderId scope the share depends on — see
      // `assertCreatorTopicTargets` for why this guard sits at the RPC
      // boundary rather than in the model defaults.
      await assertCreatorTopicTargets(guardCtx(ctx), input.topicIds);

      return ctx.topicModel.batchMoveToAgent(input.topicIds, input.targetAgentId);
    }),
  cancelRateLimitContinuation: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);
      const result = await ctx.topicModel.cancelRateLimitContinuation(input.id);
      if (result.status === 'busy')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The source continuation has already been claimed or started.',
        });
      if (result.status === 'unchanged') return null;
      return { metadata: result.metadata };
    }),
  settleRunningOperation: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        operationId: z.string(),
        status: chatTopicStatusSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      // Same visitor guard as `batchMoveTopics`/`cloneTopic` above.
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);

      // Client-reported end: never clear the marker of a run the server is still
      // driving (an early / mirrored terminal event would otherwise drop the
      // supervisor's topic reservation mid group turn).
      return ctx.topicModel.settleRunningOperation(input.id, input.operationId, input.status, {
        rejectInFlightOperation: true,
      });
    }),
};
