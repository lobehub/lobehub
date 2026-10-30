import { ROLLOUT_MAX_CANARY_SIZE } from '@lobechat/const/goal';
import type { GoalItem } from '@lobechat/types';
import { MAX_GOAL_METRIC_CRITERIA } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { GoalModel } from '@/database/models/goal';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';

/**
 * The model the goal's Tasks run on, picked at creation. Applied before the
 * first coordinator step is scheduled, through the same checks as
 * `setTaskModel`, so no Task can start on the executor's default first.
 */
const taskModelConfigInput = z.object({ model: z.string().min(1), provider: z.string().min(1) });

/**
 * Apply a creation-time task model, or remove the goal it was refused for: the
 * caller asked for a goal on that model, and the coordinator has not been
 * scheduled yet, so nothing of it has run.
 */
const applyCreatedTaskModel = async <T extends { goal: GoalItem }>(
  service: GoalService,
  graph: T,
  modelConfig: z.infer<typeof taskModelConfigInput> | undefined,
): Promise<T> => {
  if (!modelConfig) return graph;
  try {
    // The returned goal carries the model, so the caller can confirm it applied.
    return { ...graph, goal: await service.setTaskModel(graph.goal.id, modelConfig) };
  } catch (error) {
    await service.delete(graph.goal.id).catch(() => {});
    throw error;
  }
};

/** Everything a goal is created from except who owns it. */
const conversationGoalInput = z.object({
  config: z
    .object({
      acceptance: z
        .object({
          /** Numeric clauses gating acceptance; keyed by a series on this goal. */
          metrics: z
            .array(
              z.object({
                key: z.string().min(1).max(255),
                op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']).optional(),
                target: z.number(),
                title: z.string().max(255).optional(),
              }),
            )
            .max(MAX_GOAL_METRIC_CRITERIA)
            .optional(),
        })
        .optional(),
      // Bounds mirror `resolveMaxConcurrentTasks`, so a rejected value and
      // a clamped one cannot disagree about what the cap may be.
      exploration: z
        .object({
          instruction: z.string().min(1).max(8000),
          maxExperiments: z.number().int().min(1).max(200),
        })
        .optional(),
      manager: z
        .object({
          instruction: z.string().max(8000).optional(),
          maxTurns: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
      maxConcurrentTasks: z.number().int().min(1).max(10).nullable().optional(),
      supervision: z
        .object({
          enabled: z.boolean(),
          maxIncidents: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
      /** Dedicated executor for the goal's Tasks; the goal agent supervises. */
      taskAgentId: z.string().min(1).optional(),
      recovery: z
        .object({
          maxAttemptsPerTask: z.number().int().positive().optional(),
          maxStepsPerRun: z.number().int().positive().nullable().optional(),
          operationLeaseTimeoutMs: z.number().int().min(60_000).optional(),
        })
        .optional(),
      /**
       * Batch roll-out policy for a goal that is one repeated mould. Omit it and
       * the planner's own homogeneity claim decides; `off` forbids a batch even
       * when the planner claims one.
       */
      rollout: z
        .object({
          canarySize: z.number().int().min(2).max(ROLLOUT_MAX_CANARY_SIZE).optional(),
          minHomogeneousUnits: z.number().int().min(1).max(200).optional(),
          trigger: z.enum(['canary', 'full', 'off']),
          waveSize: z.number().int().min(1).max(50).optional(),
        })
        .optional(),
      schedule: z
        .object({
          /** ISO-8601 instant; past it the coordinator stops dispatching. */
          deadline: z.string().datetime().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  maxRounds: z.number().int().positive().optional(),
  maxTotalCost: z.number().positive().optional(),
  /** Structured acceptance criteria — persisted rows that gate the terminal acceptance. */
  criteria: z
    .array(
      z.object({
        description: z.string().optional(),
        instruction: z.string().optional(),
        title: z.string().min(1),
      }),
    )
    .optional(),
  /**
   * Open a conversation goal as a draft that runs only once `start` launches
   * it. Sent by a CLI that has `lh goal start`; ignored for a standalone goal.
   */
  draft: z.boolean().optional(),
  problemDescription: z.string().optional(),
  projectId: z.string().optional(),
  requirement: z.string().optional(),
  title: z.string().min(1),
  taskModelConfig: taskModelConfigInput.optional(),
  /** Seed task nodes; `dependsOn` names other seeds by title. */
  tasks: z
    .array(
      z.union([
        z.string().min(1),
        z.object({
          dependsOn: z.array(z.string().min(1)).optional(),
          description: z.string().optional(),
          title: z.string().min(1),
        }),
      ]),
    )
    .optional(),
});

const createGoalInput = conversationGoalInput.extend({
  agentId: z.string().optional(),
  /** Set by the `/goal` tool so the seeded graph is authored by the agent. */
  createdByAgentId: z.string().optional(),
});

const bindTopicInput = idInput.extend({
  /** Move a goal already bound to another topic or task. */
  force: z.boolean().optional(),
  /** Keep unfinished Tasks with their current agent when the goal agent changes. */
  goalOnly: z.boolean().optional(),
  /** The topic run doing the binding; its agent and topic are used. */
  operationId: z.string().min(1),
});

const bindTopicResponse = ({
  graph,
  previousSubject,
  reassignedTaskIds,
  topicId,
  turnToken,
}: Awaited<ReturnType<GoalService['bindTopic']>>) => ({
  data: graph,
  message:
    `Goal bound to topic ${topicId}` +
    (previousSubject.id && previousSubject.id !== topicId
      ? ` (moved from ${previousSubject.type} ${previousSubject.id})`
      : '') +
    (reassignedTaskIds.length ? `; ${reassignedTaskIds.length} task(s) reassigned` : ''),
  previousSubject,
  reassignedTaskIds,
  success: true,
  turnToken,
});

export const creationRouter = router({
  /**
   * `/goal` from a conversation run authenticated by its operation token (device
   * and gateway runs). The agent and conversation come from the operation, and
   * the returned `turnToken` lets that run plan the goal immediately.
   */
  createConversationGoal: heteroAuthedProcedure
    .use(serverDatabase)
    .input(conversationGoalInput.extend({ operationId: z.string().min(1) }))
    .mutation(async ({ ctx, input: { operationId, taskModelConfig, ...input } }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'An operation-bound token is required',
        });
      }
      let principal;
      try {
        principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'goal:manage',
          claims: ctx.heteroOperation,
          db: ctx.serverDB,
          operationId,
        });
      } catch (error) {
        if (!(error instanceof HeteroOperationPrincipalError)) throw error;
        throw new TRPCError({
          cause: error,
          code:
            error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
          message: error.message,
        });
      }
      try {
        const service = new GoalService(ctx.serverDB, principal.userId, principal.workspaceId);
        const created = await service.createFromConversation(operationId, input);
        const graph = await applyCreatedTaskModel(service, created.graph, taskModelConfig);
        const { turnToken } = created;
        await scheduleGoalAdvance({
          goalId: graph.goal.id,
          trigger: 'create',
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        });
        return { data: graph, message: 'Goal created', success: true, turnToken };
      } catch (error) {
        mapGoalError(error, 'create');
      }
    }),
  /**
   * Attach an existing goal to the topic of a run authenticated by its
   * operation token (device and gateway runs), as if the goal had been created
   * there with `/goal`. Takes the same `goal:manage` capability as creating one.
   */
  bindOperationTopic: heteroAuthedProcedure
    .use(serverDatabase)
    .input(bindTopicInput)
    .mutation(async ({ ctx, input: { id, operationId, force, goalOnly } }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'An operation-bound token is required',
        });
      }
      let principal;
      try {
        principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'goal:manage',
          claims: ctx.heteroOperation,
          db: ctx.serverDB,
          operationId,
        });
      } catch (error) {
        if (!(error instanceof HeteroOperationPrincipalError)) throw error;
        throw new TRPCError({
          cause: error,
          code:
            error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
          message: error.message,
        });
      }
      try {
        const goal = await new GoalModel(
          ctx.serverDB,
          principal.userId,
          principal.workspaceId,
        ).findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        // A token carries no workspace role, so only the goal's creator may
        // move it — the strict side of the rule `setAgent` applies.
        assertWorkspaceRowManageable(principal, goal.userId, 'goal');
        const result = await new GoalService(
          ctx.serverDB,
          principal.userId,
          principal.workspaceId,
        ).bindTopic(id, operationId, { force, goalOnly });
        await scheduleGoalAdvance({
          goalId: id,
          trigger: 'manual',
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        });
        return bindTopicResponse(result);
      } catch (error) {
        mapGoalError(error, 'bindTopic');
      }
    }),
  /**
   * Attach an existing goal to the topic run with this id (a desktop
   * run signed in as the user). Agent and topic come from the operation;
   * a local run without a server row also names them, checked like `create`.
   */
  bindTopic: goalWriteProcedure
    .input(
      bindTopicInput.extend({
        agentId: z.string().min(1).optional(),
        topicId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, operationId, agentId, topicId, force, goalOnly } }) => {
      try {
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
        const result = await ctx.goalService.bindTopic(id, operationId, {
          force,
          goalOnly,
          localRun: agentId && topicId ? { agentId, topicId } : undefined,
        });
        await scheduleGoalAdvance({
          goalId: id,
          trigger: 'manual',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return bindTopicResponse(result);
      } catch (error) {
        mapGoalError(error, 'bindTopic');
      }
    }),
  create: goalWriteProcedure
    .input(
      createGoalInput.extend({
        /**
         * Create the goal from the conversation run with this id (`/goal` on a
         * desktop run signed in as the user). Agent and conversation come from
         * the operation, so `agentId` / `createdByAgentId` are ignored.
         */
        conversationOperationId: z.string().min(1).optional(),
        /**
         * A local desktop run's operation lives only on the client, so it also
         * names its conversation; the server checks the topic belongs to the
         * caller and to this agent before accepting it.
         */
        conversationTopicId: z.string().min(1).optional(),
      }),
    )
    .mutation(
      async ({
        ctx,
        input: { conversationOperationId, conversationTopicId, taskModelConfig, ...input },
      }) => {
        try {
          if (conversationOperationId) {
            const { agentId, createdByAgentId: _createdBy, ...goalInput } = input;
            const created = await ctx.goalService.createFromConversation(
              conversationOperationId,
              goalInput,
              conversationTopicId && agentId
                ? { agentId, topicId: conversationTopicId }
                : undefined,
            );
            const graph = await applyCreatedTaskModel(
              ctx.goalService,
              created.graph,
              taskModelConfig,
            );
            const { turnToken } = created;
            await scheduleGoalAdvance({
              goalId: graph.goal.id,
              trigger: 'create',
              userId: ctx.userId,
              workspaceId: ctx.workspaceId ?? undefined,
            });
            return { data: graph, message: 'Goal created', success: true, turnToken };
          }
          const { draft: _draft, ...standaloneInput } = input;
          const data = await applyCreatedTaskModel(
            ctx.goalService,
            await ctx.goalService.create(standaloneInput),
            taskModelConfig,
          );
          // A goal is not a document — creating one means starting it. The
          // coordinator takes it from here without a client holding a loop open.
          await scheduleGoalAdvance({
            goalId: data.goal.id,
            trigger: 'create',
            userId: ctx.userId,
            workspaceId: ctx.workspaceId ?? undefined,
          });
          return { data, message: 'Goal created', success: true };
        } catch (error) {
          mapGoalError(error, 'create');
        }
      },
    ),
});
