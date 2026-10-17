import { UpdateMessagePluginSchema } from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import {
  assertCanUseConversationTargets,
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
} from '../_helpers/conversationResourceGuard';
import { resolveContext } from '../_helpers/resolveContext';
import {
  assertCreatorMessageTargets,
  assertCreatorTopicTargets,
} from '../_helpers/shareVisitorTargetGuard';
import { basicContextSchema } from '../_schema/context';
import { guardCtx, messageProcedure } from './procedures';

export const heterogeneousToolStateSnapshotSchema = z.object({
  operationId: z.string().min(1),
  snapshotSeq: z.number().int().positive(),
});

export const toolMessageProcedures = {
  updateMessagePlugin: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          id: z.string(),
          value: UpdateMessagePluginSchema.partial(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      await assertCreatorMessageTargets(guardCtx(ctx), [id]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateMessagePlugin(id, value, resolved);
    }),

  updatePluginError: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({}).passthrough().nullable(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      await assertCreatorMessageTargets(guardCtx(ctx), [id]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updatePluginError(id, value, resolved);
    }),

  updatePluginState: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({}).passthrough(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      await assertCreatorMessageTargets(guardCtx(ctx), [id]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updatePluginState(id, value, resolved);
    }),

  updateToolArguments: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          toolCallId: z.string(),
          value: z.union([z.string(), z.record(z.string(), z.unknown())]),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { toolCallId, value, agentId, ...options } = input;
      // No message id in the input — guard by the topic row when present,
      // falling back to the declared conversation target.
      if (options.topicId) await assertCanUseTopicTargets(guardCtx(ctx), [options.topicId]);
      else
        await assertCanUseConversationTargets(guardCtx(ctx), [
          { agentId, groupId: options.groupId },
        ]);
      // Same visitor guard as `addFilesToMessage` above — no message id here,
      // so it's applied to the resolved topic instead.
      if (options.topicId) await assertCreatorTopicTargets(guardCtx(ctx), [options.topicId]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateToolArguments(toolCallId, value, resolved);
    }),

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   */
  updateToolMessage: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          id: z.string(),
          value: z.object({
            content: z.string().optional(),
            heterogeneousToolState: heterogeneousToolStateSnapshotSchema.optional(),
            metadata: z.object({}).passthrough().optional(),
            pluginError: z.any().optional(),
            pluginState: z.object({}).passthrough().optional(),
          }),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      await assertCreatorMessageTargets(guardCtx(ctx), [id]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.updateToolMessage(id, value, resolved);
    }),
};
