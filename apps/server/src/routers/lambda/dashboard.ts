import { DASHBOARD_VISIBILITIES } from '@lobechat/types';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DashboardModel } from '@/database/models/dashboard';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DashboardService } from '@/server/services/dashboard';

import { mapWidgetError, notFound } from './_helpers/widgetError';

const dashboardProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      dashboardModel: new DashboardModel(ctx.serverDB, ctx.userId, workspaceId),
      dashboardService: new DashboardService(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

// Board writes need at least the member role in a workspace; personal mode passes through.
const dashboardWriteProcedure = dashboardProcedure.use(requireWorkspaceRoleWhenScoped('member'));

// ── Schemas ──

// Dashboard rows use uuid keys; reject other shapes before they reach Postgres.
const uuid = z.uuid();
const idInput = z.object({ id: uuid });
const levelInput = z
  .object({ agentId: z.string().nullish(), projectId: z.string().nullish() })
  .optional();
const visibility = z.enum(DASHBOARD_VISIBILITIES);
const metadata = z.record(z.string(), z.unknown()).nullish();
const layoutSchema = z.object({
  h: z.number().int().min(1).max(48),
  w: z.number().int().min(1).max(48),
  x: z.number().int().min(0).max(96),
  y: z.number().int().min(0),
});

const fail = (error: unknown, operation: string): never =>
  mapWidgetError(error, 'dashboard', operation);

/**
 * Dashboards (boards) and the placement of widgets on them. Widgets
 * themselves live in the `widget` router.
 *
 * Access follows `DashboardModel`: reads see readable boards (workspace
 * visibility plus the current visibility of the attached project / agent)
 * and only the widgets the caller may read; edits are limited to the board's
 * creator. Missing and forbidden rows both read as NOT_FOUND.
 */
export const dashboardRouter = router({
  /** Place a widget on a board (or move it when already there). */
  addItem: dashboardWriteProcedure
    .input(
      z.object({
        dashboardId: uuid,
        layout: layoutSchema.nullish(),
        sortOrder: z.number().int().optional(),
        widgetId: uuid,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.dashboardService.placeWidget(input.dashboardId, input.widgetId, {
          layout: input.layout,
          sortOrder: input.sortOrder,
        });
        if (!data) throw notFound('Dashboard or widget');
        return { data, message: 'Widget placed', success: true };
      } catch (error) {
        fail(error, 'place widget');
      }
    }),

  create: dashboardWriteProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        description: z.string().max(2000).nullish(),
        icon: z.string().max(100).nullish(),
        metadata,
        projectId: z.string().nullish(),
        sortOrder: z.number().int().optional(),
        title: z.string().min(1).max(200),
        visibility: visibility.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.dashboardModel.create(input);
        return { data, message: 'Dashboard created', success: true };
      } catch (error) {
        fail(error, 'create dashboard');
      }
    }),

  delete: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardModel.delete(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, message: 'Dashboard deleted', success: true };
    } catch (error) {
      fail(error, 'delete dashboard');
    }
  }),

  /** A board with its visible widgets, in display order. */
  detail: dashboardProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardService.getDetail(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, success: true };
    } catch (error) {
      fail(error, 'get dashboard');
    }
  }),

  /** Boards living directly on one level (personal / workspace, project, agent). */
  list: dashboardProcedure.input(levelInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.dashboardModel.list(input ?? {}), success: true };
    } catch (error) {
      fail(error, 'list dashboards');
    }
  }),

  /** Every board of a project, including those an agent of the project also owns. */
  listByProject: dashboardProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return { data: await ctx.dashboardModel.listByProject(input.projectId), success: true };
      } catch (error) {
        fail(error, 'list project dashboards');
      }
    }),

  removeItems: dashboardWriteProcedure
    .input(z.object({ dashboardId: uuid, itemIds: z.array(uuid).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.dashboardService.removeItems(input.dashboardId, input.itemIds);
        return { data, message: 'Widgets removed from dashboard', success: true };
      } catch (error) {
        fail(error, 'remove widgets');
      }
    }),

  restore: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardModel.restore(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, message: 'Dashboard restored', success: true };
    } catch (error) {
      fail(error, 'restore dashboard');
    }
  }),

  trash: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardModel.trash(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, message: 'Dashboard moved to trash', success: true };
    } catch (error) {
      fail(error, 'trash dashboard');
    }
  }),

  update: dashboardWriteProcedure
    .input(
      z.object({
        id: uuid,
        value: z.object({
          description: z.string().max(2000).nullish(),
          icon: z.string().max(100).nullish(),
          metadata,
          sortOrder: z.number().int().optional(),
          title: z.string().min(1).max(200).optional(),
          visibility: visibility.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.dashboardModel.update(input.id, input.value);
        if (!data) throw notFound('Dashboard');
        return { data, message: 'Dashboard updated', success: true };
      } catch (error) {
        fail(error, 'update dashboard');
      }
    }),

  /** Persist a drag-and-drop result; ids not on this board are ignored. */
  updateItemLayouts: dashboardWriteProcedure
    .input(
      z.object({
        dashboardId: uuid,
        patches: z
          .array(
            z.object({
              id: uuid,
              layout: layoutSchema.nullish(),
              sortOrder: z.number().int().optional(),
            }),
          )
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.dashboardService.saveLayout(input.dashboardId, input.patches);
        return { data, message: 'Layout saved', success: true };
      } catch (error) {
        fail(error, 'save layout');
      }
    }),
});
