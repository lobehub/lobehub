import { goalStatuses } from '@lobechat/const/goal';
import { summarizeGoalSupervision } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';
import { graphForClient } from '@/server/services/goal/graphCompat';
import { GoalManagerService, goalPlanSchema } from '@/server/services/goal/manager';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { goalProcedure, idInput, mapGoalError } from '../goalProcedures';

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
 * `GoalManagerService.assertOperationOwnsTurn`, so a token reaches exactly the
 * Goal whose current turn it holds — not any Goal in the workspace whose id it
 * learns.
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
      goalManager: new GoalManagerService(
        opts.ctx.serverDB,
        principal.userId,
        principal.workspaceId,
      ),
      goalService: new GoalService(opts.ctx.serverDB, principal.userId, principal.workspaceId),
      // The operation the token was minted for — not an id the caller supplies.
      heteroOperationId: principal.operationId,
      userId: principal.userId,
      workspaceId: principal.workspaceId ?? null,
    },
  });
});

export const readRouter = router({
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
  graph: goalProcedure
    .input(
      idInput.extend({
        /** Graph features this client renders (see `GOAL_GRAPH_CAPABILITY`). */
        capabilities: z.array(z.string()).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return {
          data: graphForClient(await ctx.goalService.graph(input.id), input.capabilities),
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'graph');
      }
    }),
  /**
   * Each declared measured clause with the value the acceptance gate reads for
   * it now. `lh goal show` / `lh goal metric list` render it.
   */
  metricState: goalProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.metricState(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'read the metrics of');
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

  // The same reads for a planning run that holds an operation token, which
  // the ordinary `goalProcedure` above refuses — see `goalOperationReadProcedure`.
  graphOperation: goalOperationReadProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      await ctx.goalManager.assertOperationOwnsTurn(input.id, ctx.heteroOperationId);
      return { data: await ctx.goalService.graph(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'graph');
    }
  }),
  metricStateOperation: goalOperationReadProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      await ctx.goalManager.assertOperationOwnsTurn(input.id, ctx.heteroOperationId);
      return { data: await ctx.goalService.metricState(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'read the metrics of');
    }
  }),
  planContextOperation: goalOperationReadProcedure
    .input(planContextInput)
    .query(async ({ ctx, input }) => {
      try {
        await ctx.goalManager.assertOperationOwnsTurn(input.id, ctx.heteroOperationId);
        return { data: await readPlanContext(ctx.goalManager, input), success: true };
      } catch (error) {
        mapGoalError(error, 'read the plan context of');
      }
    }),
  eventsOperation: goalOperationReadProcedure.input(eventsInput).query(async ({ ctx, input }) => {
    try {
      await ctx.goalManager.assertOperationOwnsTurn(input.id, ctx.heteroOperationId);
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
});
