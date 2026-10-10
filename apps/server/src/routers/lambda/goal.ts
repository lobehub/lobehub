import { goalStatuses } from '@lobechat/const/goal';
import { MAX_GOAL_METRIC_CRITERIA, summarizeGoalSupervision } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GoalModel } from '@/database/models/goal';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { GoalManagerService, goalPlanSchema } from '@/server/services/goal/manager';
import {
  DEFAULT_MANAGER_MAX_TURNS,
  managerTurnsSpent,
} from '@/server/services/goal/recoveryPolicy';
import { GoalReportStore, type SubmitGoalReportInput } from '@/server/services/goal/reportStore';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';
import { GoalWaitService, goalWakeEventSchema } from '@/server/services/goal/wait';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const goalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      goalModel: new GoalModel(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
      goalService: new GoalService(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  }),
);
const goalWriteProcedure = goalProcedure.use(withScopedPermission('agent:update'));
const idInput = z.object({ id: z.string() });
/**
 * A wrap-up report submitted from a run. The metadata passes through as a
 * record: `GoalReportStore.submit` parses it with the report schema and checks
 * every reference against the Goal graph.
 */
const reportInput = idInput.extend({
  operationId: z.string().min(1),
  report: z.object({
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

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
  problemDescription: z.string().optional(),
  projectId: z.string().optional(),
  requirement: z.string().optional(),
  title: z.string().min(1),
  /** Seed task nodes, in dependency-free order. */
  tasks: z
    .array(
      z.union([
        z.string().min(1),
        z.object({ description: z.string().optional(), title: z.string().min(1) }),
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

function mapGoalError(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  console.error(`[goal:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation} goal`,
  });
}

/** `<ISO>|<event id>` — opaque to callers, so the pair can change shape later. */
const encodeEventCursor = (cursor: { createdAt: Date; id: string }) =>
  `${cursor.createdAt.toISOString()}|${cursor.id}`;

const decodeEventCursor = (raw: string) => {
  const separator = raw.lastIndexOf('|');
  const createdAt = separator > 0 ? new Date(raw.slice(0, separator)) : new Date(Number.NaN);
  const id = separator > 0 ? raw.slice(separator + 1) : '';
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid events cursor' });
  }
  return { createdAt, id };
};

/**
 * Events paging is cursor-based, not offset-based: the feed is live and events
 * are PREPENDED while a goal runs, so an offset taken on page one re-serves a row
 * that a later insert pushed down.
 */
const eventsInput = idInput.extend({
  cursor: z.string().min(1).optional(),
  entityType: z.enum(['goal', 'node', 'edge', 'decision', 'task']).optional(),
  eventType: z
    .enum([
      'created',
      'updated',
      'activated',
      'resolved',
      'rejected',
      'retired',
      'linked',
      'unlinked',
    ])
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const planContextInput = idInput.extend({
  operationId: z.string().min(1).optional(),
  // A refused `lh goal plan` re-reads this with the plan it just submitted, so
  // the plan-specific guards it was refused on (`existing_work`,
  // `acceptance_escalate_only`, `wait_unsettled`, `wait_until_past`) are
  // re-evaluated. Without it the read would report `ok` and explain nothing.
  plan: goalPlanSchema.optional(),
  token: z.string().min(1).optional(),
});

type EventsInput = z.infer<typeof eventsInput>;
type PlanContextInput = z.infer<typeof planContextInput>;

/** Shared by the ordinary and the operation-authenticated read; the caller builds the manager. */
const readPlanContext = (manager: GoalManagerService, input: PlanContextInput) =>
  manager.admission(input.id, {
    operationId: input.operationId,
    plan: input.plan,
    token: input.token,
  });

const readEvents = async (goalService: GoalService, input: EventsInput) => {
  const page = await goalService.listEvents(input.id, {
    cursor: input.cursor ? decodeEventCursor(input.cursor) : undefined,
    entityType: input.entityType,
    eventType: input.eventType,
    limit: input.limit ?? 50,
  });
  return {
    events: page.events,
    nextCursor: page.nextCursor ? encodeEventCursor(page.nextCursor) : null,
  };
};

/**
 * The Goal reads a device / gateway planning run needs.
 *
 * Those runs hold a `hetero-operation` JWT, and `oidcAuth` deliberately refuses
 * it on ordinary authed routes so a leaked sandbox token cannot be replayed
 * elsewhere — which left a planner unable to read the very Goal it plans, and
 * made `lh goal state` (and the refusal explanation) unauthorized in exactly the
 * runs that need them. These mirror the ordinary reads for that caller only:
 * writes stay on `goalWriteProcedure`, and scope comes from the operation's own
 * principal.
 *
 * The capability is `hetero:ingest` rather than `goal:manage` because the token
 * a takeover planning turn holds never carries `goal:manage` — that is granted
 * only to the `/goal` message that creates a goal, so requiring it would leave
 * the planner locked out. `hetero:ingest` is what the same token already uses to
 * submit its plan.
 *
 * `allowTerminalOperation` is deliberately unset: reads of a run that has already
 * ended are an ordinary-session job, so the token works exactly while its turn
 * runs.
 *
 * Scope is the operation's principal AND its Goal: every endpoint calls
 * `assertOperationReadsOwnGoal`, so a token reaches exactly the Goal whose
 * current turn it holds — not any Goal in the workspace whose id it learns.
 */
const goalOperationReadProcedure = heteroAuthedProcedure.use(serverDatabase).use(async (opts) => {
  if (opts.ctx.heteroAuthKind !== 'operation' || !opts.ctx.heteroOperation) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'An operation-bound token is required',
    });
  }
  let principal;
  try {
    principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'hetero:ingest',
      claims: opts.ctx.heteroOperation,
      db: opts.ctx.serverDB,
      operationId: opts.ctx.heteroOperation.operation_id,
    });
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
  return opts.next({
    ctx: {
      goalModel: new GoalModel(opts.ctx.serverDB, principal.userId, principal.workspaceId),
      goalService: new GoalService(opts.ctx.serverDB, principal.userId, principal.workspaceId),
      // The operation the token was minted for — not an id the caller supplies.
      heteroOperationId: principal.operationId,
      userId: principal.userId,
      workspaceId: principal.workspaceId ?? null,
    },
  });
});

/**
 * A device / gateway planning run may read only the Goal its own turn belongs to.
 *
 * Holding an active `hetero:ingest` token proves the caller is *some* live run of
 * this user and workspace — not that it is THIS Goal's run. The capability is
 * also carried by runs that never plan (`heteroOperationCapabilities`), and an
 * operation id is not a Goal id; without this, a run that learns another Goal's
 * id could read that Goal's manager state and, worse, its planning `token`, then
 * submit a plan for it. The binding is the Goal's current turn: its
 * `managerState.operationId` is the run the token was minted for.
 */
const assertOperationReadsOwnGoal = async (
  ctx: { goalModel: GoalModel; heteroOperationId: string },
  goalId: string,
) => {
  const goal = await ctx.goalModel.findById(goalId);
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  if (goal.config?.managerState?.operationId !== ctx.heteroOperationId)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This run does not own the current planning turn of this goal',
    });
};

export const goalRouter = router({
  wake: goalWriteProcedure
    .input(goalWakeEventSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...event } = input;
      const goal = await ctx.goalModel.findById(id);
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
      const data = await new GoalWaitService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).deliver(id, event);
      return { data, success: true };
    }),
  // A plan is an operation result; the turn token further restricts ingestion to its Goal.
  submitOperationPlan: heteroAuthedProcedure
    .use(serverDatabase)
    .input(
      idInput.extend({
        token: z.string().min(1),
        operationId: z.string().min(1),
        plan: goalPlanSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'An operation-bound token is required',
        });
      }
      let principal;
      try {
        principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'hetero:ingest',
          claims: ctx.heteroOperation,
          db: ctx.serverDB,
          operationId: input.operationId,
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
      const data = await new GoalManagerService(
        ctx.serverDB,
        principal.userId,
        principal.workspaceId,
      ).submit(input.id, input.token, input.operationId, input.plan);
      await scheduleGoalAdvance({
        goalId: input.id,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      });
      return { data, success: true };
    }),
  // The wrap-up report of a heterogeneous agent's run: server tools never reach
  // a device run, so its report arrives through the CLI instead of the tool.
  submitOperationReport: heteroAuthedProcedure
    .use(serverDatabase)
    .input(reportInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'An operation-bound token is required',
        });
      }
      let principal;
      try {
        principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'hetero:ingest',
          claims: ctx.heteroOperation,
          db: ctx.serverDB,
          operationId: input.operationId,
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
      const data = await new GoalReportStore(
        ctx.serverDB,
        principal.userId,
        principal.workspaceId,
      ).submitFromOperation(input.id, input.report as SubmitGoalReportInput, input.operationId);
      return { data, success: true };
    }),
  submitReport: goalWriteProcedure.input(reportInput).mutation(async ({ ctx, input }) => {
    const data = await new GoalReportStore(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    ).submitFromOperation(input.id, input.report as SubmitGoalReportInput, input.operationId);
    return { data, success: true };
  }),
  submitPlan: goalWriteProcedure
    .input(
      idInput.extend({
        token: z.string().min(1),
        operationId: z.string().min(1),
        plan: goalPlanSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = await new GoalManagerService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).submit(input.id, input.token, input.operationId, input.plan);
      await scheduleGoalAdvance({
        goalId: input.id,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { data, success: true };
    }),
  addEdge: goalWriteProcedure
    .input(
      idInput.extend({
        kind: z.enum([
          'contains',
          'answers',
          'decomposes',
          'depends_on',
          'derived_from',
          'investigates',
          'produces',
          'supports',
          'contradicts',
          'leads_to',
        ]),
        sourceNodeId: z.string().uuid(),
        targetNodeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: await ctx.goalService.addEdge(
            id,
            input.sourceNodeId,
            input.targetNodeId,
            input.kind,
          ),
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'addEdge');
      }
    }),

  addNode: goalWriteProcedure
    .input(
      idInput.extend({
        description: z.string().optional(),
        kind: z.enum(['problem', 'experiment', 'task', 'finding', 'decision']),
        scopeId: z.string().uuid().optional(),
        questionId: z.string().uuid().optional(),
        priority: z.number().int().optional(),
        status: z
          .enum(['proposed', 'active', 'waiting', 'resolved', 'rejected', 'retired'])
          .optional(),
        title: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return { data: await ctx.goalService.addNode(id, input), success: true };
      } catch (error) {
        mapGoalError(error, 'addNode');
      }
    }),

  /**
   * `/goal` from a conversation run authenticated by its operation token (device
   * and gateway runs). The agent and conversation come from the operation, and
   * the returned `turnToken` lets that run plan the goal immediately.
   */
  createConversationGoal: heteroAuthedProcedure
    .use(serverDatabase)
    .input(conversationGoalInput.extend({ operationId: z.string().min(1) }))
    .mutation(async ({ ctx, input: { operationId, ...input } }) => {
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
        const { graph, turnToken } = await new GoalService(
          ctx.serverDB,
          principal.userId,
          principal.workspaceId,
        ).createFromConversation(operationId, input);
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
      async ({ ctx, input: { conversationOperationId, conversationTopicId, ...input } }) => {
        try {
          if (conversationOperationId) {
            const { agentId, createdByAgentId: _createdBy, ...goalInput } = input;
            const { graph, turnToken } = await ctx.goalService.createFromConversation(
              conversationOperationId,
              goalInput,
              conversationTopicId && agentId
                ? { agentId, topicId: conversationTopicId }
                : undefined,
            );
            await scheduleGoalAdvance({
              goalId: graph.goal.id,
              trigger: 'create',
              userId: ctx.userId,
              workspaceId: ctx.workspaceId ?? undefined,
            });
            return { data: graph, message: 'Goal created', success: true, turnToken };
          }
          const data = await ctx.goalService.create(input);
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

  /**
   * Answer a goal's clarification round at once. One advance follows all the
   * answers, so the re-plan never starts with half of them.
   */
  answerClarifications: goalWriteProcedure
    .input(
      idInput.extend({
        answers: z
          .array(
            z.object({
              decisionId: z.string().uuid(),
              optionId: z.string(),
              resolution: z.string().optional(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.goalService.answerClarifications(input.id, input.answers);
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'decide',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { message: 'Clarifications answered', success: true };
      } catch (error) {
        mapGoalError(error, 'answer clarifications for');
      }
    }),

  decide: goalWriteProcedure
    .input(
      idInput.extend({
        decisionId: z.string().uuid(),
        optionId: z.string(),
        resolution: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.goalService.decide(
          input.id,
          input.decisionId,
          input.optionId,
          input.resolution,
        );
        // Answering the gate is what unblocks the Task; carry on from here.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'decide',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Decision resolved', success: true };
      } catch (error) {
        mapGoalError(error, 'decide');
      }
    }),

  retireNodes: goalWriteProcedure
    .input(
      idInput.extend({
        nodeIds: z.array(z.string().uuid()).min(1),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Same ownership rule as restart/delete: retiring cancels the nodes'
        // Tasks and recovery gates, so visibility is not manageability.
        const goal = await ctx.goalModel.findById(input.id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.retireNodes(input.id, input.nodeIds, input.reason);
        // Retiring can unpark the goal or clear the last unfinished task. Advance
        // as the goal's owner: a workspace owner retiring a colleague's nodes
        // cannot see that colleague's private Tasks, so an advance under the
        // caller would read their bound nodes as `missing_task`.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'manual',
          userId: goal.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: `Retired ${data.retiredNodeIds.length} node(s)`, success: true };
      } catch (error) {
        mapGoalError(error, 'retireNodes');
      }
    }),

  /** Declare or clear the numeric clauses gating this goal's acceptance. */
  setMetricCriteria: goalWriteProcedure
    .input(
      idInput.extend({
        metrics: z
          .array(
            z.object({
              key: z.string().min(1).max(255),
              op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']).optional(),
              target: z.number(),
              title: z.string().max(255).optional(),
            }),
          )
          .max(MAX_GOAL_METRIC_CRITERIA),
        /** `merge` upserts by key server-side; `replace` (default) swaps the list. */
        mode: z.enum(['merge', 'replace']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const goal = await ctx.goalModel.findById(input.id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
        const data = await ctx.goalService.setMetricCriteria(input.id, input.metrics, input.mode);
        // Relaxing a clause can free a goal parked short of acceptance.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'observe',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Metric criteria updated', success: true };
      } catch (error) {
        mapGoalError(error, 'setMetricCriteria');
      }
    }),

  /**
   * Record a measurement against this goal and let the coordinator react.
   *
   * The graph otherwise only moves when a Task settles, but a long-horizon
   * goal advances when the *world* changes — a follower count, a conversion
   * rate. This is that entry point: it writes to the generic metrics layer
   * (subject = this goal) and schedules an advance, so a goal whose numeric
   * acceptance was the last thing outstanding closes on the observation
   * instead of waiting up to a sweep window.
   */
  recordObservation: goalWriteProcedure
    .input(
      idInput.extend({
        key: z.string().min(1).max(255),
        kind: z.enum(['gauge', 'counter']).optional(),
        observedAt: z.coerce.date().optional(),
        title: z.string().optional(),
        unit: z.string().optional(),
        value: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...observation } = input;
        const { shouldAdvance, ...data } = await ctx.goalService.recordObservation(id, observation);
        // A goal parked short of its measured acceptance is only worth waking
        // when the measurement actually cleared the gate; otherwise the advance
        // would tick straight back out as `goal_paused`.
        if (shouldAdvance) {
          await scheduleGoalAdvance({
            goalId: id,
            trigger: 'observe',
            userId: ctx.userId,
            workspaceId: ctx.workspaceId ?? undefined,
          });
        }
        return { data, message: 'Observation recorded', success: true };
      } catch (error) {
        mapGoalError(error, 'recordObservation');
      }
    }),

  /**
   * Run the coordinator now and report where it stopped.
   *
   * The goal advances on its own — this is the "don't wait for the next event"
   * nudge, so the surface can hand off in one call instead of holding a tick
   * loop open in the browser.
   */
  advance: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const { result, ticks } = await advanceGoal({
        goalId: input.id,
        trigger: 'manual',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { data: { ...result, ticks }, message: result.message, success: true };
    } catch (error) {
      mapGoalError(error, 'advance');
    }
  }),

  /**
   * Delete a goal and, by FK cascade, its whole graph. Anything still running
   * is stopped first; the graph Tasks themselves are deliberately left in place
   * — they are ordinary tasks with their own history and acceptance.
   */
  delete: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      // `agent:update` says the member may change goals; it does not say whose.
      // Without this any member could delete a colleague's goal and cascade its
      // whole graph away, which is the same rule tasks already enforce.
      const goal = await ctx.goalModel.findById(input.id);
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

      await ctx.goalService.delete(input.id);
      return { message: 'Goal deleted', success: true };
    } catch (error) {
      mapGoalError(error, 'delete');
    }
  }),

  /** Clarifications still waiting on the user, grouped by goal. */
  pendingForIsland: goalProcedure.query(async ({ ctx }) => {
    try {
      return { data: await ctx.goalService.pendingForIsland(), success: true };
    } catch (error) {
      mapGoalError(error, 'list pending decisions for');
    }
  }),

  pendingClarifications: goalProcedure.query(async ({ ctx }) => {
    try {
      return { data: await ctx.goalService.pendingClarifications(), success: true };
    } catch (error) {
      mapGoalError(error, 'list clarifications for');
    }
  }),

  graph: goalProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.graph(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'graph');
    }
  }),

  /**
   * Why `submitPlan` would accept or refuse a plan right now, without writing.
   *
   * `lh goal state` renders it and a refused `lh goal plan` re-reads it, so the
   * CLI explains a refusal from the same predicates the write path uses — the
   * manager and review snapshots a client cannot see from the graph alone.
   */
  planContext: goalProcedure.input(planContextInput).query(async ({ ctx, input }) => {
    try {
      const manager = new GoalManagerService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      return { data: await readPlanContext(manager, input), success: true };
    } catch (error) {
      mapGoalError(error, 'read the plan context of');
    }
  }),

  /**
   * The goal's audit trail, newest first, paged past the capped copy `graph`
   * bundles. `lh goal events` reads it.
   */
  events: goalProcedure.input(eventsInput).query(async ({ ctx, input }) => {
    try {
      return { data: await readEvents(ctx.goalService, input), success: true };
    } catch (error) {
      mapGoalError(error, 'list events of');
    }
  }),

  // The same three reads for a planning run that holds an operation token, which
  // the ordinary `goalProcedure` above refuses — see `goalOperationReadProcedure`.

  graphOperation: goalOperationReadProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      await assertOperationReadsOwnGoal(ctx, input.id);
      return { data: await ctx.goalService.graph(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'graph');
    }
  }),

  planContextOperation: goalOperationReadProcedure
    .input(planContextInput)
    .query(async ({ ctx, input }) => {
      try {
        await assertOperationReadsOwnGoal(ctx, input.id);
        const manager = new GoalManagerService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        return { data: await readPlanContext(manager, input), success: true };
      } catch (error) {
        mapGoalError(error, 'read the plan context of');
      }
    }),

  eventsOperation: goalOperationReadProcedure.input(eventsInput).query(async ({ ctx, input }) => {
    try {
      await assertOperationReadsOwnGoal(ctx, input.id);
      return { data: await readEvents(ctx.goalService, input), success: true };
    } catch (error) {
      mapGoalError(error, 'list events of');
    }
  }),

  /**
   * List goals with their graph roll-up: how many Tasks are done, how many
   * decision gates wait on a human, and what the exploration has cost.
   */
  list: goalProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        projectId: z.string().optional(),
        statuses: z.array(z.enum(goalStatuses)).optional(),
        /** Goals created from this conversation. */
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => ctx.goalModel.list(input)),

  pause: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.pause(input.id), message: 'Goal paused', success: true };
    } catch (error) {
      mapGoalError(error, 'pause');
    }
  }),

  resume: goalWriteProcedure
    .input(
      idInput.extend({
        /**
         * The owner confirms the planning turn the Goal paused on has ended, so
         * it is settled before resuming instead of pausing the Goal again.
         */
        confirmExit: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.confirmExit)
          await new GoalManagerService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ).confirmTurnExit(input.id);
        const data = await ctx.goalService.resume(input.id);
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'resume',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        // Resuming does not give the main Agent more turns, so a goal it paused
        // for running out would stop again on the next tick. Say how to continue
        // it instead of leaving the caller to replace it with a new goal.
        const message = managerTurnsSpent(data.config)
          ? `Goal resumed, but its main Agent has used all ${data.config?.manager?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS} turns and it will pause again. Raise the cap with: lh goal set-budget ${input.id} --max-manager-turns <n>`
          : 'Goal resumed';
        return { data, message, success: true };
      } catch (error) {
        mapGoalError(error, 'resume');
      }
    }),

  /**
   * End the goal by hand — achieved or canceled — and interrupt its live runs.
   * Reopening a closed goal is `resume`.
   */
  close: goalWriteProcedure
    .input(idInput.extend({ status: z.enum(['achieved', 'canceled']) }))
    .mutation(async ({ ctx, input: { id, status } }) => {
      try {
        // Closing cancels live runs, so it carries the same ownership check as restart.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.close(id, status);
        return { data, message: `Goal ${status}`, success: true };
      } catch (error) {
        mapGoalError(error, 'close');
      }
    }),

  /**
   * Start every unfinished Task node over (cancel stale runs, back to
   * `backlog`), optionally under a different agent, and kick the coordinator
   * so the goal begins moving without a second gesture.
   */
  restart: goalWriteProcedure
    .input(idInput.extend({ agentId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input: { id, agentId } }) => {
      try {
        // `agent:update` says the member may change goals; it does not say
        // whose. Without this any member could restart a colleague's visible
        // goal — cancel its live runs and reset its tasks.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.restart(id, { agentId });
        await scheduleGoalAdvance({
          goalId: id,
          trigger: 'restart',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return {
          data,
          message: `Restarted ${data.restartedTaskIds.length} task(s)`,
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'restart');
      }
    }),

  /** Rebind which persisted verify criteria gate this goal's terminal acceptance. */
  setAcceptanceCriteria: goalWriteProcedure
    .input(idInput.extend({ criteriaIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.goalService.setAcceptanceCriteria(input.id, input.criteriaIds);
        return { success: true };
      } catch (error) {
        mapGoalError(error, 'setAcceptanceCriteria');
      }
    }),

  /**
   * Hand the goal to a different agent — the one that supervises and plans it.
   * When that agent also does the goal's Tasks, unfinished ones follow by
   * default (`goalOnly` keeps them); Tasks mid-run switch on their next attempt.
   */
  setAgent: goalWriteProcedure
    .input(idInput.extend({ agentId: z.string().min(1), goalOnly: z.boolean().optional() }))
    .mutation(async ({ ctx, input: { id, agentId, goalOnly } }) => {
      try {
        // Same ownership rule as restart/delete: visibility is not
        // manageability, so only the goal's owner may hand it to a new agent.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.setAgent(id, agentId, { goalOnly });
        const reassigned = data.reassignedTaskIds.length;
        return {
          data,
          message: reassigned
            ? `Goal agent updated; ${reassigned} task(s) reassigned`
            : 'Goal agent updated',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'setAgent');
      }
    }),

  /**
   * Route the goal's Tasks to a dedicated executor (`null` hands them back to
   * the goal agent). Unfinished Tasks follow unless `goalOnly` is set.
   */
  setTaskAgent: goalWriteProcedure
    .input(
      idInput.extend({ agentId: z.string().min(1).nullable(), goalOnly: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input: { id, agentId, goalOnly } }) => {
      try {
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.setTaskAgent(id, agentId, { goalOnly });
        const reassigned = data.reassignedTaskIds.length;
        return {
          data,
          message: reassigned
            ? `Task agent updated; ${reassigned} task(s) reassigned`
            : 'Task agent updated',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'setTaskAgent');
      }
    }),

  setBudget: goalWriteProcedure
    .input(
      idInput.extend({
        /** ISO-8601 calendar-time budget; null clears the deadline. */
        deadline: z.string().datetime().nullable().optional(),
        maxAttemptsPerTask: z.number().int().positive().optional(),
        /** null restores the default concurrency. */
        maxConcurrentTasks: z.number().int().min(1).max(10).nullable().optional(),
        maxExperiments: z.number().int().min(1).max(200).optional(),
        /** Main Agent turn cap; only for a goal that has a main Agent. */
        maxManagerTurns: z.number().int().min(1).max(100).optional(),
        maxRounds: z.number().int().positive().nullable().optional(),
        /** null removes the per-run step cap. */
        maxStepsPerRun: z.number().int().positive().nullable().optional(),
        maxTotalCost: z.number().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...budget } }) => {
      try {
        const data = await ctx.goalService.setBudget(id, budget);
        // Raising a budget is how a user un-sticks a goal that stopped on one;
        // it should start moving again without a second gesture.
        await scheduleGoalAdvance({
          goalId: id,
          trigger: 'budget',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Goal budget updated', success: true };
      } catch (error) {
        mapGoalError(error, 'setBudget');
      }
    }),

  supervision: goalProcedure.input(idInput).query(async ({ ctx, input }) => {
    const graph = await ctx.goalService.graph(input.id);
    const state = graph.goal.config?.supervisorState;
    return {
      data: {
        enabled: graph.goal.config?.supervision?.enabled ?? false,
        state,
        summary: summarizeGoalSupervision(state),
      },
      success: true,
    };
  }),

  tick: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.tick(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'tick');
    }
  }),

  updateRequirement: goalWriteProcedure
    .input(idInput.extend({ requirement: z.string().min(1) }))
    .mutation(async ({ ctx, input: { id, requirement } }) => {
      try {
        return { data: await ctx.goalService.updateRequirement(id, requirement), success: true };
      } catch (error) {
        mapGoalError(error, 'updateRequirement');
      }
    }),
});
