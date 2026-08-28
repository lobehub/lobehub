import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentSignalSelfReviewBriefService } from '@/server/services/agentSignal/services/briefs/selfReview';
import { NIGHTLY_REVIEW_BRIEF_TRIGGER } from '@/server/services/agentSignal/services/selfIteration/review/brief';
import { BriefService } from '@/server/services/brief';

const briefProcedure = wsCompatProcedure.use(serverDatabase);

/**
 * Every brief mutation, gated on the writable-role permission.
 *
 * `workspace_viewer` is read-only by product decision, and a brief write is not
 * the inert per-user bookkeeping it looks like: `resolve`, `resolveManyAsRead`
 * and `delete` all clear the `hasUnresolvedUrgentByTask` predicate that parks a
 * task between automated runs (`taskLifecycle`, `heartbeatTick`,
 * `scheduleTick`). Dismissing a brief therefore lets the agent resume and spend
 * workspace budget — an action, not a read. `markRead` alone has no lifecycle
 * effect, but a read-only role gets no brief writes at all; one rule beats a
 * carve-out nobody will remember.
 *
 * `agent:update` is the permission every writable built-in role holds
 * (`:all` for Owner, `:owner` for Admin/Member) and Viewer does not. It is NOT
 * `task:update` — that is not an RBAC action at all and is rejected for every
 * role including Owner, which is what broke this router before (lobehub#17507).
 */
const briefWriteProcedure = briefProcedure.use(withScopedPermission('agent:update'));

const idInput = z.object({ id: z.string() });

const createSchema = z.object({
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
  agentId: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  cronJobId: z.string().optional(),
  priority: z.enum(['urgent', 'normal', 'info']).default('info'),
  summary: z.string().min(1),
  taskId: z.string().optional(),
  title: z.string().min(1),
  topicId: z.string().optional(),
  type: z.enum(['decision', 'result', 'insight', 'error']),
});

const listSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  type: z.string().optional(),
});

export const briefRouter = router({
  create: briefWriteProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const { artifacts, ...rest } = input;
      // Legacy clients pass artifacts as a flat doc-id list; the storage shape
      // is the structured `BriefArtifacts` object. Adapt at the boundary.
      const createData: Parameters<BriefModel['create']>[0] = {
        ...rest,
        artifacts: artifacts?.length
          ? { documents: artifacts.map((id) => ({ id, kind: null, title: null })) }
          : undefined,
      };

      // Resolve taskId if it's an identifier
      if (createData.taskId) {
        const taskModel = new TaskModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const task = await taskModel.resolve(createData.taskId);
        if (task) createData.taskId = task.id;
      }

      const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const brief = await model.create(createData);
      return { data: brief, message: 'Brief created', success: true };
    } catch (error) {
      console.error('[brief:create]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create brief',
      });
    }
  }),

  delete: briefWriteProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const deleted = await model.delete(input.id);
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      return { message: 'Brief deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[brief:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete brief',
      });
    }
  }),

  find: briefProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const brief = await model.findById(input.id);
      if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      return { data: brief, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[brief:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find brief',
      });
    }
  }),

  findByTaskId: briefProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const items = await model.findByTaskId(input.taskId);
        return { data: items, success: true };
      } catch (error) {
        console.error('[brief:findByTaskId]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to find briefs',
        });
      }
    }),

  list: briefProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const service = new BriefService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const result = await service.list(input);

      return { data: result.briefs, success: true, total: result.total };
    } catch (error) {
      console.error('[brief:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list briefs',
      });
    }
  }),

  // Day-scoped news digest for the home inbox. The client computes the local
  // [startAt, endAt) day boundaries — the server has no per-user timezone on
  // this path, and absolute instants keep the query timezone-agnostic.
  listNewsByDay: briefProcedure
    .input(z.object({ endAt: z.coerce.date(), startAt: z.coerce.date() }))
    .query(async ({ input, ctx }) => {
      try {
        const service = new BriefService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const { data, hasEarlier } = await service.listNewsByDay(input);
        return { data, hasEarlier, success: true };
      } catch (error) {
        console.error('[brief:listNewsByDay]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list news briefs',
        });
      }
    }),

  listUnresolved: briefProcedure.query(async ({ ctx }) => {
    try {
      const service = new BriefService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const data = await service.listUnresolved();
      return { data, success: true };
    } catch (error) {
      console.error('[brief:listUnresolved]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list unresolved briefs',
      });
    }
  }),

  markRead: briefWriteProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const brief = await model.markRead(input.id);
      if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      return { data: brief, message: 'Brief marked as read', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[brief:markRead]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to mark brief as read',
      });
    }
  }),

  resolve: briefWriteProcedure
    .input(
      idInput.merge(
        z.object({
          action: z.string().optional(),
          comment: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const currentBrief = await model.findById(input.id);
        if (!currentBrief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });

        const resolveOptions = {
          action: input.action,
          comment: input.comment,
        };
        const wsId = ctx.workspaceId ?? undefined;
        const brief =
          currentBrief.trigger === NIGHTLY_REVIEW_BRIEF_TRIGGER
            ? await new AgentSignalSelfReviewBriefService(ctx.serverDB, ctx.userId, wsId).resolve(
                currentBrief,
                resolveOptions,
              )
            : await new BriefService(ctx.serverDB, ctx.userId, wsId).resolve(
                input.id,
                resolveOptions,
              );

        if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
        return { data: brief, message: 'Brief resolved', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[brief:resolve]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resolve brief',
        });
      }
    }),

  // Bulk "mark all read" from the home inbox news section. Always resolves
  // with the neutral `read` action — never `approve` — so clearing a pile of
  // reports can't complete their tasks as a side effect.
  resolveManyAsRead: briefWriteProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new BriefModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const resolvedIds = await model.resolveManyAsRead(input.ids);
        return { data: resolvedIds, success: true };
      } catch (error) {
        console.error('[brief:resolveManyAsRead]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resolve briefs',
        });
      }
    }),
});
