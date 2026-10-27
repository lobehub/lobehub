import type { McpElicitationCheckpoint } from '@lobechat/mcp-elicitation';
import { parseMcpElicitationRequest } from '@lobechat/mcp-elicitation';
import type { ElicitRequestParams } from '@modelcontextprotocol/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { requireWorkspaceRoleWhenScoped } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { aiAgentBaseProcedure } from '@/server/routers/lambda/aiAgent/procedures';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';
import { scheduleMcpElicitationResume } from '@/server/services/mcp/elicitation/queue';
import { redisService } from '@/server/services/redis';

const procedure = aiAgentBaseProcedure.use(async ({ ctx, next }) =>
  next({
    ctx: {
      mcpElicitation: new McpElicitationService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  }),
);
const writeProcedure = procedure
  .use(requireWorkspaceRoleWhenScoped('member'))
  .use(withScopedPermission('message:create'));
const identitySchema = z.object({
  apiName: z.string().min(1),
  assistantMessageId: z.string().min(1),
  identifier: z.string().min(1),
  operationId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolMessageId: z.string().optional(),
});
const responseSchema = z
  .object({
    action: z.enum(['accept', 'decline', 'cancel']),
    content: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
  })
  .strict();

export const mcpElicitationRouter = router({
  beginProducer: writeProcedure
    .input(
      z.object({
        identity: identitySchema,
        producerId: z.string().uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        deadline: z.number().finite(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.mcpElicitation.assertIdentity(input.identity);
      const claimed = await redisService.agentToolResults.claimMcpProducer(
        {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
          operationId: input.identity.operationId,
          toolCallId: input.identity.toolCallId,
        },
        input.producerId,
        input.fingerprint,
        input.deadline,
      );
      return { claimed };
    }),
  producerResult: writeProcedure
    .input(
      z.object({
        identity: identitySchema,
        result: z.object({
          content: z.string(),
          success: z.boolean(),
          state: z.record(z.string(), z.unknown()).optional(),
          error: z.object({ message: z.string(), type: z.string().optional() }).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { operation } = await ctx.mcpElicitation.assertIdentity(input.identity, true);
      if (['done', 'error', 'interrupted', 'abandoned'].includes(operation.status))
        return { success: true, ignored: true };
      const toolMessageId = await ctx.mcpElicitation.messages.findToolMessageIdByToolCallId(
        input.identity.toolCallId,
        input.identity.assistantMessageId,
      );
      await redisService.agentToolResults.publishMcpResult(
        input.identity.operationId,
        {
          ...input.result,
          toolCallId: input.identity.toolCallId,
          state: { ...input.result.state, mcpToolMessageId: toolMessageId },
        },
        ctx.workspaceId ?? undefined,
      );
      return { success: true };
    }),
  pending: procedure
    .input(z.object({ topicId: z.string(), threadId: z.string().nullable().optional() }))
    .query(async ({ input, ctx }) => {
      const plugins = await ctx.mcpElicitation.messages.listMessagePluginsByTopic(input.topicId);
      const pending = plugins.filter(
        (plugin) => plugin.state?.mcpElicitation && plugin.intervention?.status === 'pending',
      );
      const items = await Promise.all(
        pending.map(async (plugin) => {
          const state = plugin.state!.mcpElicitation as {
            batchId: string;
            deadline: number;
            legacy?: boolean;
          };
          if (!plugin.intervention?.operationId || state.deadline <= Date.now()) return undefined;
          const message = await ctx.mcpElicitation.messages.findById(plugin.id);
          if (
            !message ||
            message.userId !== ctx.userId ||
            (message.threadId ?? null) !== (input.threadId ?? null)
          )
            return undefined;
          const operation = await ctx.mcpElicitation.operations.findById(
            plugin.intervention.operationId,
          );
          if (
            !operation ||
            operation.userId !== ctx.userId ||
            ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status)
          )
            return undefined;
          const batch = await ctx.mcpElicitation.interventions.findBatch(
            plugin.intervention.operationId,
            state.batchId,
          );
          const item = batch.interventions[0];
          const detail = item?.sanitizedRequest.customDetail;
          if (
            !item ||
            !['pending', 'resolving'].includes(item.status) ||
            detail?.kind !== 'mcp_elicitation'
          )
            return undefined;
          // Recover an outbox whose submitting process died before enqueueing.
          if (item.status === 'resolving' && !state.legacy) {
            const resolution = batch.resolutions.find(
              (entry) => entry.actorId === ctx.userId && entry.source === 'mcp',
            );
            if (resolution)
              await scheduleMcpElicitationResume(
                ctx.mcpElicitation,
                item.id,
                resolution.resolutionRequestId,
              );
          }
          return {
            apiName: plugin.apiName!,
            assistantMessageId: message.parentId!,
            batchId: item.batchId,
            deadline: item.deadline.getTime(),
            identifier: plugin.identifier!,
            serverName: detail.serverName,
            id: item.id,
            operationId: item.operationId,
            requests: JSON.parse(detail.requests) as Record<string, ElicitRequestParams>,
            resolving: item.status === 'resolving',
            toolCallId: plugin.toolCallId!,
            toolMessageId: plugin.id,
          };
        }),
      );
      return items.filter((item) => item !== undefined);
    }),
  resolve: writeProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        resolutionRequestId: z.string().uuid(),
        responses: z.record(z.string(), responseSchema),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { prior } = await ctx.mcpElicitation.claim(
          input.itemId,
          input.resolutionRequestId,
          input.responses,
        );
        if (prior && ['acknowledged', 'completed', 'published'].includes(prior.status))
          return { state: 'resolved' as const };
        return await scheduleMcpElicitationResume(
          ctx.mcpElicitation,
          input.itemId,
          input.resolutionRequestId,
        );
      } catch (cause) {
        throw new TRPCError({
          code: 'CONFLICT',
          cause,
          message: cause instanceof Error ? cause.message : 'MCP elicitation could not be resolved',
        });
      }
    }),
  legacyRequest: writeProcedure
    .input(
      z.object({
        identity: identitySchema,
        request: z.unknown(),
        checkpoint: z
          .object({
            inputRequired: z.unknown(),
            round: z.number().int().min(1).max(10),
            legacyUrl: z.boolean().optional(),
          })
          .optional(),
        deadline: z.number(),
      }),
    )
    .mutation(async ({ input, ctx, signal }) => {
      const request = await parseMcpElicitationRequest(
        input.request,
        !!input.checkpoint && !input.checkpoint.legacyUrl,
      ).catch((cause: unknown) => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid MCP elicitation request',
          cause,
        });
      });
      const deadline = Math.min(input.deadline, Date.now() + 120_000);
      return ctx.mcpElicitation.createLegacyHost(input.identity, deadline).request(request, {
        checkpoint: input.checkpoint as McpElicitationCheckpoint | undefined,
        signal: signal ?? AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    }),
});
