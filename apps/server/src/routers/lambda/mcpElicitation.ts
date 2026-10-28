import { setTimeout as delay } from 'node:timers/promises';

import type { McpElicitationCheckpoint } from '@lobechat/mcp-elicitation';
import { parseMcpElicitationRequest } from '@lobechat/mcp-elicitation';
import type { PendingMcpElicitation } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { requireWorkspaceRoleWhenScoped } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { aiAgentBaseProcedure } from '@/server/routers/lambda/aiAgent/procedures';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import {
  cancelClientMcpStep,
  registerClientMcpStep,
  scheduleClientMcpTool,
} from '@/server/services/mcp/elicitation/clientStep';
import { resolveMcpProducerUser } from '@/server/services/mcp/elicitation/deviceGrant';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';
import {
  recoverMcpElicitationResume,
  scheduleMcpElicitationResume,
} from '@/server/services/mcp/elicitation/queue';
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
  .use(withScopedPermission('message:create'))
  .use(({ ctx, next }) =>
    next({
      ctx: {
        mcpElicitation: new AgentRuntimeService(ctx.serverDB, ctx.userId, {
          workspaceId: ctx.workspaceId ?? undefined,
        }).createMcpElicitationService(),
      },
    }),
  );
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
  registerClientStep: writeProcedure
    .input(
      z.object({
        assistantMessageId: z.string(),
        toolMessageIds: z.array(z.string()).min(1).max(64),
        localHostTimeoutMs: z.number().finite().positive().optional(),
        toolResultMaxLength: z.number().finite().optional(),
        owner: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => registerClientMcpStep(ctx.mcpElicitation, input)),
  clientSteps: procedure
    .input(z.object({ topicId: z.string(), threadId: z.string().nullable().optional() }))
    .query(({ ctx, input }) =>
      ctx.mcpElicitation.invocations.clientSteps(input.topicId, input.threadId),
    ),
  leaseClientStep: writeProcedure
    .input(
      z.object({
        operationId: z.string(),
        owner: z.string().uuid(),
        finish: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.mcpElicitation.invocations.leaseClientStep(input.operationId, input.owner, input.finish),
    ),
  cancelClientStep: writeProcedure
    .input(z.object({ operationId: z.string(), owner: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      cancelClientMcpStep(ctx.mcpElicitation, input.operationId, input.owner),
    ),
  startClientTool: writeProcedure.input(identitySchema).mutation(async ({ ctx, input }) => {
    await scheduleClientMcpTool(ctx.mcpElicitation, input);
    return { success: true };
  }),
  clientToolOutcome: procedure.input(identitySchema).query(async ({ ctx, input, signal }) => {
    const { operation } = await ctx.mcpElicitation.assertIdentity(input, true);
    if (!operation.metadata?.clientMcpStep) throw new Error('Not a client MCP invocation');
    const id = await ctx.mcpElicitation.ensureToolMessage(input);
    for (let attempt = 0; attempt < 40; attempt++) {
      const row = await ctx.mcpElicitation.messages.findById(id);
      const plugin = await ctx.mcpElicitation.messages.findMessagePlugin(id);
      if (row?.content || row?.error || plugin?.error || plugin?.state?.mcpClientComplete)
        return {
          content: row?.content ?? '',
          state: plugin?.state ?? {},
          success: !row?.error && !plugin?.error,
          error: plugin?.error ?? undefined,
        };
      await delay(500, undefined, { signal: signal ?? undefined });
    }
    return null;
  }),
  recover: writeProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(({ ctx, input }) => recoverMcpElicitationResume(ctx.mcpElicitation, input.itemId)),
  beginProducer: writeProcedure
    .input(
      z.object({
        identity: identitySchema,
        delegation: z.string().optional(),
        producerId: z.string().uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        deadline: z.number().finite(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = await resolveMcpProducerUser(
        ctx,
        input.identity,
        input.delegation,
        input.deadline,
      );
      const interactions = new McpElicitationService(
        ctx.serverDB,
        userId,
        ctx.workspaceId ?? undefined,
      );
      await interactions.assertIdentity(input.identity);
      const claimed = await interactions.invocations.claimProducer(
        {
          userId,
          workspaceId: ctx.workspaceId ?? undefined,
          operationId: input.identity.operationId,
          assistantMessageId: input.identity.assistantMessageId,
          toolCallId: input.identity.toolCallId,
        },
        input.producerId,
        input.fingerprint,
        input.deadline,
      );
      return { claimed, initiatorUserId: userId };
    }),
  producerResult: writeProcedure
    .input(
      z.object({
        identity: identitySchema,
        delegation: z.string().optional(),
        result: z.object({
          content: z.string(),
          success: z.boolean(),
          state: z.record(z.string(), z.unknown()).optional(),
          error: z.object({ message: z.string(), type: z.string().optional() }).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = await resolveMcpProducerUser(ctx, input.identity, input.delegation);
      const interactions = new McpElicitationService(
        ctx.serverDB,
        userId,
        ctx.workspaceId ?? undefined,
      );
      const { operation } = await interactions.assertIdentity(input.identity, true);
      if (['done', 'error', 'interrupted', 'abandoned'].includes(operation.status))
        return { success: true, ignored: true };
      const toolMessageId = await interactions.messages.findToolMessageIdByToolCallId(
        input.identity.toolCallId,
        input.identity.assistantMessageId,
      );
      if (operation.metadata?.clientMcpStep && toolMessageId) {
        await interactions.messages.updateToolMessage(toolMessageId, {
          content: input.result.content,
          pluginState: { ...input.result.state, mcpElicitation: null, mcpClientComplete: true },
          pluginError: input.result.success
            ? null
            : (input.result.error ?? { message: input.result.content }),
          onlyIfEmpty: true,
        });
        await interactions.messages.updateMessagePlugin(toolMessageId, {
          intervention: { status: 'none' },
        });
        return { success: true };
      }
      await redisService.agentToolResults.publishMcpResult(
        { ...input.identity, userId, workspaceId: ctx.workspaceId ?? undefined },
        {
          ...input.result,
          toolCallId: input.identity.toolCallId,
          state: { ...input.result.state, mcpToolMessageId: toolMessageId },
        },
      );
      return { success: true };
    }),
  pending: procedure
    .input(z.object({ topicId: z.string(), threadId: z.string().nullable().optional() }))
    .query(async ({ input, ctx }): Promise<PendingMcpElicitation[]> => {
      return ctx.mcpElicitation.invocations.listPending(input.topicId, input.threadId);
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
        delegation: z.string().optional(),
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
      const userId = await resolveMcpProducerUser(
        ctx,
        input.identity,
        input.delegation,
        input.deadline,
      );
      const interactions = new AgentRuntimeService(ctx.serverDB, userId, {
        workspaceId: ctx.workspaceId ?? undefined,
      }).createMcpElicitationService();
      return interactions.createLegacyHost(input.identity, deadline).request(request, {
        checkpoint: input.checkpoint as McpElicitationCheckpoint | undefined,
        signal: signal ?? AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    }),
});
