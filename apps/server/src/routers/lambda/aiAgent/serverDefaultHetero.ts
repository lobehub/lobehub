import { getServerDefaultHeterogeneousAgentConfig } from '@lobechat/heterogeneous-agents';
import { isServerDefaultHeterogeneousRelayInvocation, RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { agentOperations, workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { signHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import {
  describeServerDefaultHeterogeneousModel,
  getServerDefaultHeterogeneousModels,
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES,
} from '@/server/modules/ModelRuntime';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';

import { resolveHeteroTopicWorkspace } from './guards';
import { aiAgentBaseProcedure } from './procedures';

const log = debug('lobe-server:ai-agent-router');

const assertServerDefaultControlAuth = (oidcAuth: Record<string, unknown> | null | undefined) => {
  if (!oidcAuth || oidcAuth.purpose) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Server-default operations require Desktop OIDC authentication',
    });
  }
};

export const resolveServerDefaultHeterogeneousCapability = async () => {
  const base = {
    model: 'lobehub-default' as const,
  };
  if (process.env.ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT === '0') {
    return { ...base, agents: [], enabled: false as const, reason: 'disabled' as const };
  }

  try {
    const models = await getServerDefaultHeterogeneousModels();
    const agents = SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES.filter(
      (agentType) => models[agentType].length > 0,
    );
    if (agents.length === 0) {
      return {
        ...base,
        agents,
        enabled: false as const,
        models,
        reason: 'invalidConfiguration' as const,
      };
    }
    return { ...base, agents, enabled: true as const, models };
  } catch (error) {
    log('Server-default heterogeneous capability is unavailable: %O', error);
    return {
      ...base,
      agents: [],
      enabled: false as const,
      reason: 'invalidConfiguration' as const,
    };
  }
};

const resolveServerDefaultControlOperation = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
}) => {
  const [operation] = await params.db
    .select({
      metadata: agentOperations.metadata,
      model: agentOperations.model,
      provider: agentOperations.provider,
      status: agentOperations.status,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(
      and(eq(agentOperations.id, params.operationId), eq(agentOperations.userId, params.userId)),
    )
    .limit(1);

  if (!operation || operation.metadata?.serverDefaultHeterogeneous !== true) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Operation is outside the caller scope' });
  }

  if (operation.workspaceId) {
    const [membership] = await params.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, operation.workspaceId),
          eq(workspaceMembers.userId, params.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Operation is outside the caller scope' });
    }
  }

  return {
    model: new AgentOperationModel(params.db, params.userId, operation.workspaceId ?? undefined),
    operation,
  };
};

const settleServerDefaultControlOperation = async (params: {
  currentStatus: string;
  model: AgentOperationModel;
  operationId: string;
  targetStatus: 'done' | 'error' | 'interrupted';
}) => {
  if (params.currentStatus === params.targetStatus) return;
  if (params.currentStatus !== 'running') {
    throw new TRPCError({ code: 'CONFLICT', message: 'Operation has already ended' });
  }

  if (await params.model.settleRunning(params.operationId, params.targetStatus)) return;

  // Another terminal request won the CAS after the scope read. Treat an
  // identical terminal result as idempotent and reject a conflicting result.
  const current = await params.model.findById(params.operationId);
  if (current?.status !== params.targetStatus) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Operation has already ended' });
  }
};

export const serverDefaultHeteroRouter = router({
  getServerDefaultHeterogeneousCapability: aiAgentBaseProcedure.query(() =>
    resolveServerDefaultHeterogeneousCapability(),
  ),
  /**
   * Model-card facts Desktop writes into a CLI's model catalog for a model the
   * CLI has no entry for. Read with `mutation` semantics so Desktop main can
   * reach it over its plain-POST tRPC helper; it changes nothing.
   */
  describeServerDefaultHeterogeneousModel: aiAgentBaseProcedure
    .input(
      z.object({
        agentType: z.enum(SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES),
        model: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      return describeServerDefaultHeterogeneousModel(input.agentType, input.model).catch(
        (error) => {
          throw new TRPCError({
            cause: error,
            code: 'BAD_REQUEST',
            message: 'The selected server model is not available for this heterogeneous agent',
          });
        },
      );
    }),
  beginServerDefaultHeterogeneousOperation: aiAgentBaseProcedure
    .input(
      z.object({
        agentType: z.enum(SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES),
        agentId: z.string().optional(),
        model: z.string().min(1),
        operationId: z.string().min(1),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      const workspaceId = await resolveHeteroTopicWorkspace({
        db: ctx.serverDB,
        requestedWorkspaceId: ctx.workspaceId,
        topicId: input.topicId,
        userId: ctx.userId,
      });
      if (workspaceId && input.agentId) {
        await assertCanUseWorkspaceAgent({
          agentId: input.agentId,
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId,
        });
      }
      const capability = await resolveServerDefaultHeterogeneousCapability();
      if (!capability.enabled) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            capability.reason === 'disabled'
              ? 'Server-default agents are disabled'
              : 'No server model is available',
        });
      }
      const selection = await resolveServerDefaultHeterogeneousModel(
        input.agentType,
        input.model,
      ).catch((error) => {
        throw new TRPCError({
          cause: error,
          code: 'BAD_REQUEST',
          message: 'The selected server model is not available for this heterogeneous agent',
        });
      });
      await initModelRuntimeFromServerConfig({
        actorUserId: ctx.userId,
        workspaceId,
      }).catch((error) => {
        log('Selected server model runtime is unavailable: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'PRECONDITION_FAILED',
          message: 'The selected server model runtime is unavailable',
        });
      });

      const model = new AgentOperationModel(ctx.serverDB, ctx.userId, workspaceId);
      await model.recordStart({
        agentId: input.agentId,
        metadata: { agentType: input.agentType, serverDefaultHeterogeneous: true },
        model: selection.model,
        operationId: input.operationId,
        provider: selection.provider,
        topicId: input.topicId,
        trigger: RequestTrigger.Chat,
      });
      const operation = await model.findById(input.operationId);
      if (
        !operation ||
        operation.userId !== ctx.userId ||
        operation.workspaceId !== (workspaceId ?? null) ||
        operation.status !== 'running' ||
        operation.topicId !== input.topicId ||
        operation.agentId !== (input.agentId ?? null) ||
        operation.model !== selection.model ||
        operation.provider !== selection.provider ||
        operation.metadata?.agentType !== input.agentType
      ) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Operation id is already in use' });
      }

      return {
        model: 'lobehub-default' as const,
        token: await signHeteroOperationJWT({
          capabilities: ['model:invoke'],
          model: selection.model,
          operationId: input.operationId,
          providerId: selection.provider,
          userId: ctx.userId,
          workspaceId,
        }),
      };
    }),
  finishServerDefaultHeterogeneousOperation: aiAgentBaseProcedure
    .input(z.object({ operationId: z.string().min(1), result: z.enum(['done', 'error']) }))
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      const { model, operation } = await resolveServerDefaultControlOperation({
        db: ctx.serverDB,
        operationId: input.operationId,
        userId: ctx.userId,
      });
      const relayInvocation = operation.metadata?.serverDefaultRelayInvocation;
      const agentType = operation.metadata?.agentType;
      const agentConfig =
        typeof agentType === 'string'
          ? getServerDefaultHeterogeneousAgentConfig(agentType)
          : undefined;
      const verifiedRelayInvocation =
        isServerDefaultHeterogeneousRelayInvocation(relayInvocation) &&
        agentConfig?.ingress === relayInvocation.ingress &&
        relayInvocation.operationId === input.operationId &&
        relayInvocation.agentType === agentType &&
        relayInvocation.model === operation.model &&
        relayInvocation.provider === operation.provider
          ? relayInvocation
          : null;
      await settleServerDefaultControlOperation({
        currentStatus: operation.status,
        model,
        operationId: input.operationId,
        targetStatus: input.result,
      });
      return { relayInvocation: verifiedRelayInvocation, success: true as const };
    }),
  cancelServerDefaultHeterogeneousOperation: aiAgentBaseProcedure
    .input(z.object({ operationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      const { model, operation } = await resolveServerDefaultControlOperation({
        db: ctx.serverDB,
        operationId: input.operationId,
        userId: ctx.userId,
      });
      await settleServerDefaultControlOperation({
        currentStatus: operation.status,
        model,
        operationId: input.operationId,
        targetStatus: 'interrupted',
      });
      return { success: true as const };
    }),
});
