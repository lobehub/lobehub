import { DashboardApiName } from '@lobechat/builtin-tool-dashboard';
import { DashboardExecutionRuntime } from '@lobechat/builtin-tool-dashboard/executionRuntime';
import { DASHBOARD_VISIBILITIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DashboardModel } from '@/database/models/dashboard';
import { DashboardWidgetModel } from '@/database/models/dashboardWidget';
import { DashboardScopeError } from '@/database/utils/dashboardScope';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DashboardWidgetFlowError, DashboardWidgetService } from '@/server/services/dashboard';
import {
  createDashboardToolService,
  resolveClientTopic,
} from '@/server/services/dashboard/agentTool';
import { widgetVersionContentSchema } from '@/server/services/dashboard/versionSchema';

const dashboardProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      dashboardModel: new DashboardModel(ctx.serverDB, ctx.userId, workspaceId),
      widgetModel: new DashboardWidgetModel(ctx.serverDB, ctx.userId, workspaceId),
      widgetService: new DashboardWidgetService(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

// Writes — including running a widget, which spends sandbox time — need at
// least the member role in a workspace; personal mode passes through.
const dashboardWriteProcedure = dashboardProcedure.use(requireWorkspaceRoleWhenScoped('member'));

// ── Schemas ──

// Dashboard rows use uuid keys; reject other shapes before they reach Postgres.
const uuid = z.uuid();
const idInput = z.object({ id: uuid });
const levelInput = z
  .object({
    agentId: z.string().nullish(),
    projectId: z.string().nullish(),
  })
  .optional();
const visibility = z.enum(DASHBOARD_VISIBILITIES);
const layoutSchema = z.object({
  h: z.number().int().min(1).max(48),
  w: z.number().int().min(1).max(48),
  x: z.number().int().min(0).max(96),
  y: z.number().int().min(0),
});

// ── Error mapping ──

const FLOW_ERROR_CODES = {
  DRY_RUN_REQUIRED: 'PRECONDITION_FAILED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_SCHEDULE: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  NOT_ROLLBACK_TARGET: 'BAD_REQUEST',
  NO_VERSION: 'PRECONDITION_FAILED',
} as const;

function mapDashboardError(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof DashboardWidgetFlowError) {
    throw new TRPCError({ code: FLOW_ERROR_CODES[error.code], message: error.message });
  }
  if (error instanceof DashboardScopeError) {
    throw new TRPCError({
      code: error.code === 'SCOPE_MISMATCH' ? 'BAD_REQUEST' : 'NOT_FOUND',
      message: error.message,
    });
  }
  console.error(`[dashboard:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation}`,
  });
}

const notFound = (what: string) =>
  new TRPCError({ code: 'NOT_FOUND', message: `${what} not found` });

/**
 * Dashboards, widgets, widget versions and runs.
 *
 * Access follows the models: reads see what `buildWorkspaceWhere` exposes
 * (workspace members see public boards / widgets and their own private ones),
 * edits are limited to the creator, and running a published widget is open to
 * any member who can see it. Missing and forbidden rows both read as
 * NOT_FOUND so ids from other scopes are not confirmed to exist.
 */
export const dashboardRouter = router({
  // ── Dashboards ──

  list: dashboardProcedure.input(levelInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.dashboardModel.list(input ?? {}), success: true };
    } catch (error) {
      mapDashboardError(error, 'list dashboards');
    }
  }),

  /** A board with its placed widgets, in display order. */
  detail: dashboardProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      const dashboard = await ctx.dashboardModel.findById(input.id);
      if (!dashboard) throw notFound('Dashboard');
      const items = await ctx.dashboardModel.listItems(input.id);
      return { data: { ...dashboard, items }, success: true };
    } catch (error) {
      mapDashboardError(error, 'get dashboard');
    }
  }),

  create: dashboardWriteProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        description: z.string().max(2000).nullish(),
        icon: z.string().max(100).nullish(),
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
        mapDashboardError(error, 'create dashboard');
      }
    }),

  update: dashboardWriteProcedure
    .input(
      z.object({
        id: uuid,
        value: z.object({
          description: z.string().max(2000).nullish(),
          icon: z.string().max(100).nullish(),
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
        mapDashboardError(error, 'update dashboard');
      }
    }),

  trash: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardModel.trash(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, message: 'Dashboard moved to trash', success: true };
    } catch (error) {
      mapDashboardError(error, 'trash dashboard');
    }
  }),

  restore: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardModel.restore(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, message: 'Dashboard restored', success: true };
    } catch (error) {
      mapDashboardError(error, 'restore dashboard');
    }
  }),

  delete: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.dashboardModel.delete(input.id);
      if (!data) throw notFound('Dashboard');
      return { data, message: 'Dashboard deleted', success: true };
    } catch (error) {
      mapDashboardError(error, 'delete dashboard');
    }
  }),

  // ── Items (widget placement) ──

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
        const data = await ctx.dashboardModel.addItem(input.dashboardId, input.widgetId, {
          layout: input.layout,
          sortOrder: input.sortOrder,
        });
        if (!data) throw notFound('Dashboard or widget');
        return { data, message: 'Widget placed', success: true };
      } catch (error) {
        mapDashboardError(error, 'place widget');
      }
    }),

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
        const data = await ctx.dashboardModel.updateItemLayouts(input.dashboardId, input.patches);
        return { data, message: 'Layout saved', success: true };
      } catch (error) {
        mapDashboardError(error, 'save layout');
      }
    }),

  removeItems: dashboardWriteProcedure
    .input(z.object({ dashboardId: uuid, itemIds: z.array(uuid).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.dashboardModel.removeItems(input.dashboardId, input.itemIds);
        return { data, message: 'Widgets removed from dashboard', success: true };
      } catch (error) {
        mapDashboardError(error, 'remove widgets');
      }
    }),

  // ── Widgets ──

  listWidgets: dashboardProcedure.input(levelInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.widgetModel.list(input ?? {}), success: true };
    } catch (error) {
      mapDashboardError(error, 'list widgets');
    }
  }),

  /** A widget with its published and draft versions and the boards it is placed on. */
  widgetDetail: dashboardProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      const widget = await ctx.widgetModel.findById(input.id);
      if (!widget) throw notFound('Widget');
      const [publishedVersion, draftVersion, dashboards] = await Promise.all([
        widget.publishedVersionId
          ? ctx.widgetModel.findVersion(widget.id, widget.publishedVersionId)
          : undefined,
        widget.draftVersionId
          ? ctx.widgetModel.findVersion(widget.id, widget.draftVersionId)
          : undefined,
        ctx.dashboardModel.listByWidget(widget.id),
      ]);
      return {
        data: {
          ...widget,
          dashboards,
          draftVersion: draftVersion ?? null,
          publishedVersion: publishedVersion ?? null,
        },
        success: true,
      };
    } catch (error) {
      mapDashboardError(error, 'get widget');
    }
  }),

  createWidget: dashboardWriteProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        /** Place the new widget on this board right away. */
        dashboardId: uuid.optional(),
        description: z.string().max(2000).nullish(),
        layout: layoutSchema.nullish(),
        projectId: z.string().nullish(),
        title: z.string().min(1).max(200),
        visibility: visibility.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { dashboardId, layout, ...widgetInput } = input;
        const widget = await ctx.widgetModel.create(widgetInput);
        const item = dashboardId
          ? await ctx.dashboardModel.addItem(dashboardId, widget.id, { layout })
          : undefined;
        if (dashboardId && !item) throw notFound('Dashboard');
        return {
          data: { ...widget, item: item ?? null },
          message: 'Widget created',
          success: true,
        };
      } catch (error) {
        mapDashboardError(error, 'create widget');
      }
    }),

  updateWidget: dashboardWriteProcedure
    .input(
      z.object({
        id: uuid,
        value: z.object({
          description: z.string().max(2000).nullish(),
          title: z.string().min(1).max(200).optional(),
          visibility: visibility.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetModel.update(input.id, input.value);
        if (!data) throw notFound('Widget');
        return { data, message: 'Widget updated', success: true };
      } catch (error) {
        mapDashboardError(error, 'update widget');
      }
    }),

  /** Set (cron pattern) or clear (null) the refresh schedule. */
  setWidgetSchedule: dashboardWriteProcedure
    .input(
      z.object({
        id: uuid,
        pattern: z.string().max(100).nullable(),
        timezone: z.string().max(64).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.setSchedule(input.id, input.pattern, input.timezone);
        if (!data) throw notFound('Widget');
        return { data, message: 'Schedule saved', success: true };
      } catch (error) {
        mapDashboardError(error, 'set widget schedule');
      }
    }),

  trashWidget: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetModel.trash(input.id);
      if (!data) throw notFound('Widget');
      return { data, message: 'Widget moved to trash', success: true };
    } catch (error) {
      mapDashboardError(error, 'trash widget');
    }
  }),

  restoreWidget: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetModel.restore(input.id);
      if (!data) throw notFound('Widget');
      return { data, message: 'Widget restored', success: true };
    } catch (error) {
      mapDashboardError(error, 'restore widget');
    }
  }),

  deleteWidget: dashboardWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetModel.delete(input.id);
      if (!data) throw notFound('Widget');
      return { data, message: 'Widget deleted', success: true };
    } catch (error) {
      mapDashboardError(error, 'delete widget');
    }
  }),

  // ── Versions ──

  listVersions: dashboardProcedure
    .input(z.object({ widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        if (!(await ctx.widgetModel.findById(input.widgetId))) throw notFound('Widget');
        return { data: await ctx.widgetModel.listVersions(input.widgetId), success: true };
      } catch (error) {
        mapDashboardError(error, 'list widget versions');
      }
    }),

  getVersion: dashboardProcedure
    .input(z.object({ versionId: uuid, widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetModel.findVersion(input.widgetId, input.versionId);
        if (!data) throw notFound('Version');
        return { data, success: true };
      } catch (error) {
        mapDashboardError(error, 'get widget version');
      }
    }),

  /** Record script + contract as the widget's draft; identical content reuses the draft. */
  saveDraft: dashboardWriteProcedure
    .input(widgetVersionContentSchema.extend({ widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { widgetId, ...version } = input;
        const data = await ctx.widgetService.saveDraft(widgetId, {
          ...version,
          sourceType: 'user',
        });
        return { data, message: 'Draft saved', success: true };
      } catch (error) {
        mapDashboardError(error, 'save widget draft');
      }
    }),

  /** Execute a draft (default: the current one) without touching the live widget. */
  dryRun: dashboardWriteProcedure
    .input(z.object({ versionId: uuid.optional(), widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.dryRun(input.widgetId, { versionId: input.versionId });
        return { data, message: `Dry run ${data?.status}`, success: true };
      } catch (error) {
        mapDashboardError(error, 'dry-run widget');
      }
    }),

  publish: dashboardWriteProcedure
    .input(z.object({ versionId: uuid, widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.publish(input.widgetId, input.versionId);
        return { data, message: 'Version published', success: true };
      } catch (error) {
        mapDashboardError(error, 'publish widget version');
      }
    }),

  /** Re-publish a previously published version (default: the one last replaced). */
  rollback: dashboardWriteProcedure
    .input(z.object({ versionId: uuid.optional(), widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.rollback(input.widgetId, input.versionId);
        return { data, message: 'Version rolled back', success: true };
      } catch (error) {
        mapDashboardError(error, 'roll back widget version');
      }
    }),

  // ── Agent tool ──

  /**
   * Execute one `lobe-dashboard` tool call for an agent run driven by the
   * client runtime. The server agent runtime executes the same runtime and
   * service in-process; both scope created widgets to the conversation's
   * agent and (for a project topic) project. Publishing still requires the
   * user's approval, which the agent runtime enforces before dispatching.
   */
  runAgentTool: dashboardWriteProcedure
    .input(
      z.object({
        apiName: z.enum(Object.values(DashboardApiName) as [string, ...string[]]),
        args: z.record(z.string(), z.unknown()),
        context: z
          .object({
            agentId: z.string().nullish(),
            messageId: z.string().nullish(),
            operationId: z.string().nullish(),
            topicId: z.string().nullish(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const context = input.context ?? {};
      const topic = await resolveClientTopic(ctx.serverDB, context.topicId, ctx.userId);
      const runtime = new DashboardExecutionRuntime(
        createDashboardToolService(ctx.serverDB, {
          agentId: context.agentId ?? undefined,
          messageId: context.messageId ?? undefined,
          operationId: context.operationId ?? undefined,
          projectId: topic.projectId,
          topicId: topic.topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        }),
      );
      const method = runtime[input.apiName as keyof DashboardExecutionRuntime] as (
        args: unknown,
      ) => ReturnType<DashboardExecutionRuntime['listDashboards']>;
      return method.call(runtime, input.args);
    }),

  // ── Runs ──

  /** Refresh the published version now. */
  runWidget: dashboardWriteProcedure
    .input(z.object({ widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.runNow(input.widgetId);
        return { data, message: `Run ${data?.status}`, success: true };
      } catch (error) {
        mapDashboardError(error, 'run widget');
      }
    }),

  listRuns: dashboardProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional(), widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        if (!(await ctx.widgetModel.findById(input.widgetId))) throw notFound('Widget');
        const data = await ctx.widgetModel.listRuns(input.widgetId, { limit: input.limit });
        return { data, success: true };
      } catch (error) {
        mapDashboardError(error, 'list widget runs');
      }
    }),

  getRun: dashboardProcedure
    .input(z.object({ runId: uuid, widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetModel.findRun(input.widgetId, input.runId);
        if (!data) throw notFound('Run');
        return { data, success: true };
      } catch (error) {
        mapDashboardError(error, 'get widget run');
      }
    }),
});
