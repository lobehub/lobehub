import {
  CreateNewMessageParamsSchema,
  omitServerOwnedMessageMetadata,
  UpdateMessageParamsSchema,
  UpdateMessageRAGParamsSchema,
} from '@lobechat/types';
import { createTimingHelpers, createTimingRequestId } from '@lobechat/utils';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { type MessageBatchOperation } from '@/server/services/message';

import {
  assertCanUseConversationTargets,
  assertCanUseCreateMessageTargets,
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
} from '../_helpers/conversationResourceGuard';
import { resolveAgentIdFromSession, resolveContext } from '../_helpers/resolveContext';
import {
  assertCreatorMessageTargets,
  assertCreatorTopicTargets,
} from '../_helpers/shareVisitorTargetGuard';
import { basicContextSchema } from '../_schema/context';
import { guardCtx, messageProcedure } from './procedures';
import { heterogeneousToolStateSnapshotSchema } from './toolMessages';

const { logTiming, runTimedStage } = createTimingHelpers('lobe-server:chat:lobehub:timing');

const messageBatchOperationSchema = z.discriminatedUnion('type', [
  z.object({
    message: CreateNewMessageParamsSchema,
    type: z.literal('createMessage'),
  }),
  z.object({
    id: z.string(),
    type: z.literal('updateMessage'),
    value: UpdateMessageParamsSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal('updateToolMessage'),
    value: z.object({
      content: z.string().optional(),
      heterogeneousToolState: heterogeneousToolStateSnapshotSchema.optional(),
      metadata: z.object({}).passthrough().optional(),
      pluginError: z.any().optional(),
      pluginState: z.record(z.string(), z.any()).optional(),
    }),
  }),
]);

export const writeProcedures = {
  addFilesToMessage: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          fileIds: z.array(z.string()),
          id: z.string(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, fileIds, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      // Agent-share visitor messages live under the creator's `userId`;
      // attaching files to one on the creator's behalf would leak into the
      // visitor's transcript — see `assertCreatorMessageTargets` for why this
      // guard sits at the RPC boundary rather than in the model defaults.
      await assertCreatorMessageTargets(guardCtx(ctx), [id]);
      const resolved = await resolveContext(
        { agentId, ...options },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.messageService.addFilesToMessage(id, fileIds, resolved);
    }),

  batchMutate: messageProcedure
    .use(withScopedPermission('message:create'))
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        operations: z.array(messageBatchOperationSchema).min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const operations: MessageBatchOperation[] = await Promise.all(
        input.operations.map(async (rawOperation): Promise<MessageBatchOperation> => {
          // Creates are passthrough, so a client could carry server-owned metadata.
          const operation =
            rawOperation.type === 'createMessage'
              ? {
                  ...rawOperation,
                  message: {
                    ...rawOperation.message,
                    metadata: omitServerOwnedMessageMetadata(rawOperation.message.metadata),
                  },
                }
              : rawOperation;
          if (
            operation.type !== 'createMessage' ||
            operation.message.agentId ||
            !operation.message.sessionId
          ) {
            return operation as MessageBatchOperation;
          }

          const agentId = await resolveAgentIdFromSession(
            operation.message.sessionId,
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );

          return {
            ...operation,
            message: {
              ...operation.message,
              agentId: agentId!,
            },
          } as MessageBatchOperation;
        }),
      );

      const targetedIds = operations.flatMap((op) => (op.type === 'createMessage' ? [] : [op.id]));
      await assertCanUseMessageTargets(guardCtx(ctx), targetedIds);
      // Same visitor exclusion the single-message update RPCs apply — the
      // batch path reaches the ownership-only model writes directly.
      await assertCreatorMessageTargets(guardCtx(ctx), targetedIds);
      await assertCanUseCreateMessageTargets(
        guardCtx(ctx),
        operations.flatMap((op) => (op.type === 'createMessage' ? [op.message] : [])),
      );
      // Creates carry no message id, but they DO name a topic: refuse to
      // append creator rows into a visitor transcript (the workspace guard
      // above is a no-op in personal mode, where every share lives).
      await assertCreatorTopicTargets(
        guardCtx(ctx),
        operations.flatMap((op) =>
          op.type === 'createMessage' && op.message.topicId ? [op.message.topicId] : [],
        ),
      );

      return ctx.messageService.batchMutate(operations);
    }),

  createMessage: messageProcedure
    .use(withScopedPermission('message:create'))
    .input(CreateNewMessageParamsSchema)
    .mutation(async ({ input, ctx }) => {
      // If there's no agentId but has sessionId, resolve agentId from sessionId
      let agentId = input.agentId;
      if (!agentId && input.sessionId) {
        agentId = (await resolveAgentIdFromSession(
          input.sessionId,
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ))!;
      }

      await assertCanUseConversationTargets(guardCtx(ctx), [{ agentId, groupId: input.groupId }]);
      // The declared agent/group is client-supplied and can be omitted or
      // forged while still inserting into `topicId` — guard the topic's own
      // DB-resolved target as well.
      if (input.topicId) {
        await assertCanUseTopicTargets(guardCtx(ctx), [input.topicId]);
        // Visitor topics carry the creator's userId, so ownership alone would
        // let the creator write into a visitor's private transcript.
        await assertCreatorTopicTargets(guardCtx(ctx), [input.topicId]);
      }

      // Create message with the resolved agentId. The input is passthrough, so
      // server-owned metadata a client slipped in is dropped here.
      return ctx.messageService.createMessage({
        ...input,
        agentId,
        metadata: omitServerOwnedMessageMetadata(input.metadata),
      } as any);
    }),

  update: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z
        .object({
          id: z.string(),
          value: UpdateMessageParamsSchema,
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, value, agentId, ...options } = input;
      await assertCanUseMessageTargets(guardCtx(ctx), [id]);
      // Agent-share visitor messages live under the creator's `userId`, so the
      // ownership predicate alone would let a creator edit a visitor's turn —
      // see `assertCreatorMessageTargets` for why the guard sits here and not
      // in the model defaults (the runtime writes visitor turns through them).
      await assertCreatorMessageTargets(guardCtx(ctx), [id]);
      const timingContext = { requestId: createTimingRequestId(), startedAt: Date.now() };
      logTiming(timingContext, 'lambda.message.update:start', {
        hasAgentId: !!agentId,
        hasTopicId: !!options.topicId,
        valueKeys: Object.keys(value ?? {}),
      });

      const resolved = await runTimedStage(
        timingContext,
        'lambda.message.update.resolveContext',
        () =>
          resolveContext(
            { agentId, ...options },
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ),
        { hasAgentId: !!agentId },
      );

      const result = await runTimedStage(
        timingContext,
        'lambda.message.update.service',
        () =>
          ctx.messageService.updateMessage(id, value as any, {
            ...resolved,
            timingRequestId: timingContext.requestId,
            timingStartedAt: timingContext.startedAt,
          }),
        { hasResolvedTopicId: !!resolved.topicId },
      );

      logTiming(timingContext, 'lambda.message.update:done', {
        messageCount: result.messages?.length ?? 0,
        success: result.success,
      });
      return result;
    }),

  updateMetadata: messageProcedure
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

      return ctx.messageService.updateMetadata(id, omitServerOwnedMessageMetadata(value), resolved);
    }),

  updateMessageRAG: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(UpdateMessageRAGParamsSchema.extend(basicContextSchema.shape))
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

      return ctx.messageService.updateMessageRAG(id, value, resolved);
    }),

  updateTTS: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        id: z.string(),
        value: z
          .object({
            contentMd5: z.string().optional(),
            file: z.string().optional(),
            voice: z.string().optional(),
          })
          .or(z.literal(false)),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseMessageTargets(guardCtx(ctx), [input.id]);
      await assertCreatorMessageTargets(guardCtx(ctx), [input.id]);
      if (input.value === false) {
        return ctx.messageModel.deleteMessageTTS(input.id);
      }

      return ctx.messageModel.updateTTS(input.id, input.value);
    }),

  updateTranslate: messageProcedure
    .use(withScopedPermission('message:update'))
    .input(
      z.object({
        id: z.string(),
        value: z
          .object({
            content: z.string().optional(),
            from: z.string().optional(),
            to: z.string(),
          })
          .or(z.literal(false)),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseMessageTargets(guardCtx(ctx), [input.id]);
      await assertCreatorMessageTargets(guardCtx(ctx), [input.id]);
      if (input.value === false) {
        return ctx.messageModel.deleteMessageTranslate(input.id);
      }

      return ctx.messageModel.updateTranslate(input.id, input.value);
    }),
};
