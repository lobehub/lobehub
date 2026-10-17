import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import {
  assertCanUseConversationTargets,
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
} from '../_helpers/conversationResourceGuard';
import { resolveContext } from '../_helpers/resolveContext';
import { assertCreatorTopicTargets } from '../_helpers/shareVisitorTargetGuard';
import { basicContextSchema } from '../_schema/context';
import { guardCtx, messageProcedure } from './procedures';

export const removalProcedures = {
  removeMessage: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z
        .object({
          id: z.string(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.removeMessage(id, resolved);
    }),

  removeMessageQuery: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanUseMessageTargets(guardCtx(ctx), [input.id]);

      return ctx.messageModel.deleteMessageQuery(input.id);
    }),

  removeMessages: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z
        .object({
          ids: z.array(z.string()),
          /** Skip the recycle bin: internal cleanup whose rows must never be restored. */
          permanent: z.boolean().optional(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { ids, agentId, permanent, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), ids);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.removeMessages(ids, resolved, { permanent });
    }),

  removeMessagesByAssistant: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z
        .object({
          groupId: z.string().nullish(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...options } = input;
      // Row-based guard via the topic when available; sweeps without a topic
      // fall back to the declared agent target.
      if (options.topicId) await assertCanUseTopicTargets(guardCtx(ctx), [options.topicId]);
      else
        await assertCanUseConversationTargets(guardCtx(ctx), [{ agentId, groupId: input.groupId }]);
      // Same visitor guard as `addFilesToMessage` above.
      if (options.topicId) await assertCreatorTopicTargets(guardCtx(ctx), [options.topicId]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageModel.deleteMessagesBySession(
        resolved.sessionId,
        resolved.topicId,
        input.groupId,
      );
    }),

  removeMessagesByGroup: messageProcedure
    .use(withScopedPermission('message:delete'))
    .input(
      z.object({
        groupId: z.string(),
        topicId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.topicId) await assertCanUseTopicTargets(guardCtx(ctx), [input.topicId]);
      else await assertCanUseConversationTargets(guardCtx(ctx), [{ groupId: input.groupId }]);
      // Same visitor guard as `addFilesToMessage` above.
      if (input.topicId) await assertCreatorTopicTargets(guardCtx(ctx), [input.topicId]);

      return ctx.messageModel.deleteMessagesBySession(null, input.topicId, input.groupId);
    }),
};
