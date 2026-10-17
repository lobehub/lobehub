import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import {
  assertWorkspaceRowManageable,
  shouldRestrictBulkDeleteToCreator,
} from '../_helpers/assertWorkspaceRowManageable';
import {
  assertCanUseConversationTargets,
  assertCanUseSessionTargets,
} from '../_helpers/conversationResourceGuard';
import { resolveContext } from '../_helpers/resolveContext';
import { guardCtx, topicProcedure } from './procedures';

const topicBulkDeleteScopeSchema = z.enum(['own', 'workspace']).default('own');

export const removeProcedures = {
  batchDelete: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const rows = await ctx.topicModel.findOwnersByIds(input.ids);
      for (const userId of new Set(rows.map((row) => row.userId))) {
        assertWorkspaceRowManageable(ctx, userId, 'topic');
      }

      await ctx.trashService.trashTopics(input.ids);
    }),
  batchDeleteByAgentId: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ agentId: z.string(), scope: topicBulkDeleteScopeSchema }))
    .mutation(async ({ input, ctx }) => {
      const restrictToCreator = shouldRestrictBulkDeleteToCreator(ctx, input.scope);

      await ctx.trashService.trashTopicsByAgent(input.agentId, { restrictToCreator });
    }),
  batchDeleteByGroupId: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ groupId: z.string(), scope: topicBulkDeleteScopeSchema }))
    .mutation(async ({ input, ctx }) => {
      await assertCanUseConversationTargets(guardCtx(ctx), [{ groupId: input.groupId }]);
      const restrictToCreator = shouldRestrictBulkDeleteToCreator(ctx, input.scope);

      await ctx.trashService.trashTopicsByGroup(input.groupId, { restrictToCreator });
    }),
  batchDeleteBySessionId: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(
      z.object({
        agentId: z.string().optional(),
        id: z.string().nullish(),
        scope: topicBulkDeleteScopeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const resolved = await resolveContext(
        { agentId: input.agentId, sessionId: input.id },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      if (input.agentId) {
        await assertCanUseConversationTargets(guardCtx(ctx), [{ agentId: input.agentId }]);
      } else if (resolved.sessionId) {
        await assertCanUseSessionTargets(guardCtx(ctx), [resolved.sessionId]);
      }

      const restrictToCreator = shouldRestrictBulkDeleteToCreator(ctx, input.scope);

      await ctx.trashService.trashTopicsBySession(resolved.sessionId, { restrictToCreator });
    }),
  removeAllTopics: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .mutation(async ({ ctx }) => {
      await ctx.trashService.trashAllTopics();
    }),
  /**
   * Move a topic to the recycle bin. With `removeFiles`, the attachments only
   * this topic references go along as children and are dropped from storage
   * when the topic is purged (restore brings them back too).
   */
  removeTopic: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ id: z.string(), removeFiles: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      // `findOwnTopicById` (not `findById`): an agent-share visitor topic is
      // stored under the creator's `userId`, and `TopicModel.delete` refuses to
      // remove it. Resolving through the visitor-excluding lookup keeps the
      // file cleanup below from destroying a visitor conversation's attachments
      // (DB rows + S3 objects) while the topic itself survives.
      const topic = await ctx.topicModel.findOwnTopicById(input.id);
      if (topic) assertWorkspaceRowManageable(ctx, topic.userId, 'topic');

      // No creator-visible topic behind this id: nothing to trash.
      if (!topic) return;

      await ctx.trashService.trashTopics([input.id], { removeFiles: input.removeFiles });
    }),
};
