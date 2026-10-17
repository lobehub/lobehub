import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import { assertCanUseTopicTargets } from '../_helpers/conversationResourceGuard';
import {
  assertCreatorMessageTargets,
  assertCreatorTopicTargets,
} from '../_helpers/shareVisitorTargetGuard';
import { guardCtx, messageProcedure } from './procedures';

export const topicTreeProcedures = {
  /**
   * Cancel compression by deleting the compression group and restoring original messages
   */
  cancelCompression: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string().nullish(),
        messageGroupId: z.string(),
        sourceGroupIds: z.array(z.string()).optional(),
        threadId: z.string().nullish(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageGroupId, agentId, groupId, threadId, topicId } = input;
      await assertCanUseTopicTargets(guardCtx(ctx), [topicId]);
      // Same visitor guard as `addFilesToMessage` above.
      await assertCreatorTopicTargets(guardCtx(ctx), [topicId]);

      return ctx.messageService.cancelCompression(messageGroupId, {
        agentId,
        groupId,
        threadId,
        topicId,
      });
    }),

  /**
   * Create a compression group for old messages
   * Creates a placeholder group, marks messages as compressed
   * Returns messages to summarize for frontend AI generation
   */
  createCompressionGroup: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string().nullish(),
        messageIds: z.array(z.string()),
        threadId: z.string().nullish(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { topicId, messageIds, agentId, groupId, threadId } = input;
      await assertCanUseTopicTargets(guardCtx(ctx), [topicId]);
      // Same visitor guard as `addFilesToMessage` above, plus the message ids
      // themselves — compression reads and rewrites their content.
      await assertCreatorTopicTargets(guardCtx(ctx), [topicId]);
      await assertCreatorMessageTargets(guardCtx(ctx), messageIds);

      return ctx.messageService.createCompressionGroup(topicId, messageIds, {
        agentId,
        groupId,
        threadId,
        topicId,
      });
    }),

  /**
   * Finalize compression by updating the group with generated summary
   */
  finalizeCompression: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        groupId: z.string().nullish(),
        messageGroupId: z.string(),
        threadId: z.string().nullish(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageGroupId, content, ...params } = input;
      await assertCanUseTopicTargets(guardCtx(ctx), [params.topicId]);
      // Same visitor guard as `addFilesToMessage` above.
      await assertCreatorTopicTargets(guardCtx(ctx), [params.topicId]);

      return ctx.messageService.finalizeCompression(messageGroupId, content, params);
    }),

  /**
   * Report the messages this topic's tree keeps off screen, and what could be done about it.
   * Read-only — the repair is a separate, explicit call.
   */
  diagnoseTopic: messageProcedure
    .input(z.object({ agentId: z.string().nullish(), topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.topicDoctorRepo.diagnose(input);
    }),

  /**
   * Rewrite the minimum needed to put those messages back on screen. The patch is re-derived
   * from the database here rather than taken from the client — this edits conversation
   * history, so it runs off the server's own view of the tree.
   */
  repairTopic: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(z.object({ agentId: z.string().nullish(), topicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.topicDoctorRepo.repair(input);
    }),

  /**
   * Update message group metadata (e.g., expanded state)
   */
  updateMessageGroupMetadata: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        context: z.object({
          agentId: z.string(),
          groupId: z.string().nullish(),
          threadId: z.string().nullish(),
          topicId: z.string(),
        }),
        expanded: z.boolean().optional(),
        messageGroupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageGroupId, expanded, context } = input;
      await assertCanUseTopicTargets(guardCtx(ctx), [context.topicId]);
      // Same visitor guard as `addFilesToMessage` above.
      await assertCreatorTopicTargets(guardCtx(ctx), [context.topicId]);

      return ctx.messageService.updateMessageGroupMetadata(messageGroupId, { expanded }, context);
    }),
};
