import { WIDGET_VISIBILITIES } from '@lobechat/types';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DashboardModel } from '@/database/models/dashboard';
import { WidgetModel } from '@/database/models/widget';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DashboardService } from '@/server/services/dashboard';
import { WidgetService } from '@/server/services/widget';
import { widgetVersionContentSchema } from '@/server/services/widget/versionSchema';

import { assertDashboardEnabled } from './_helpers/dashboardFeatureGate';
import { mapWidgetError, notFound } from './_helpers/widgetError';

const widgetProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  // Off by default (runtime flag `dashboard`); covers `runAgentTool` too.
  await assertDashboardEnabled(ctx.userId);
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      dashboardModel: new DashboardModel(ctx.serverDB, ctx.userId, workspaceId),
      dashboardService: new DashboardService(ctx.serverDB, ctx.userId, workspaceId),
      widgetModel: new WidgetModel(ctx.serverDB, ctx.userId, workspaceId),
      widgetService: new WidgetService(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

// Writes — including running a widget, which spends sandbox time — need at
// least the member role in a workspace; personal mode passes through.
const widgetWriteProcedure = widgetProcedure.use(requireWorkspaceRoleWhenScoped('member'));

// ── Schemas ──

// Widget rows use uuid keys; reject other shapes before they reach Postgres.
const uuid = z.uuid();
const idInput = z.object({ id: uuid });
const levelInput = z
  .object({ agentId: z.string().nullish(), projectId: z.string().nullish() })
  .optional();
const visibility = z.enum(WIDGET_VISIBILITIES);
const metadata = z.record(z.string(), z.unknown()).nullish();
const layoutSchema = z.object({
  h: z.number().int().min(1).max(48),
  w: z.number().int().min(1).max(48),
  x: z.number().int().min(0).max(96),
  y: z.number().int().min(0),
});

// A declaration (not an arrow const) so `fail(...)` narrows control flow as `never`.
function fail(error: unknown, operation: string): never {
  return mapWidgetError(error, 'widget', operation);
}

/**
 * Widgets, their versions and runs.
 *
 * Access follows `WidgetModel`: reads see what the caller may read (workspace
 * visibility plus the current visibility of the attached project / agent),
 * edits are limited to the creator, and running a published widget is open
 * to any member who can see it. Missing and forbidden rows both read as
 * NOT_FOUND.
 */
export const widgetRouter = router({
  /**
   * Create a widget; with `dashboardId`, place it on that board right away.
   * Creation and placement share one transaction: when the board cannot take
   * the widget — refused up front, or gone by the time it is placed — the
   * request fails and no orphan widget is left behind.
   */
  create: widgetWriteProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        dashboardId: uuid.optional(),
        description: z.string().max(2000).nullish(),
        layout: layoutSchema.nullish(),
        metadata,
        projectId: z.string().nullish(),
        title: z.string().min(1).max(200),
        visibility: visibility.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { dashboardId, layout, ...widgetInput } = input;
        if (!dashboardId) {
          const widget = await ctx.widgetModel.create(widgetInput);
          return { data: { ...widget, item: null }, message: 'Widget created', success: true };
        }

        if (!(await ctx.dashboardService.findManageable(dashboardId))) {
          throw notFound('Dashboard');
        }

        const workspaceId = ctx.workspaceId ?? undefined;
        const data = await ctx.serverDB.transaction(async (tx) => {
          const txDB = tx as LobeChatDatabase;
          const widget = await new WidgetModel(txDB, ctx.userId, workspaceId).create(widgetInput);
          const item = await new DashboardService(txDB, ctx.userId, workspaceId).placeWidget(
            dashboardId,
            widget.id,
            { layout },
          );
          // The board vanished after the check: roll the widget back with it.
          if (!item) throw notFound('Dashboard');
          return { ...widget, item };
        });

        return { data, message: 'Widget created', success: true };
      } catch (error) {
        fail(error, 'create widget');
      }
    }),

  delete: widgetWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetModel.delete(input.id);
      if (!data) throw notFound('Widget');
      return { data, message: 'Widget deleted', success: true };
    } catch (error) {
      fail(error, 'delete widget');
    }
  }),

  /** A widget with its published and draft versions and the boards it is placed on. */
  detail: widgetProcedure.input(idInput).query(async ({ ctx, input }) => {
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
      fail(error, 'get widget');
    }
  }),

  /** Execute a draft (default: the current one) without touching the live widget. */
  dryRun: widgetWriteProcedure
    .input(z.object({ versionId: uuid.optional(), widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.dryRun(input.widgetId, { versionId: input.versionId });
        return { data, message: `Dry run ${data?.status}`, success: true };
      } catch (error) {
        fail(error, 'dry-run widget');
      }
    }),

  getRun: widgetProcedure
    .input(z.object({ runId: uuid, widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetModel.findRun(input.widgetId, input.runId);
        if (!data) throw notFound('Run');
        return { data, success: true };
      } catch (error) {
        fail(error, 'get widget run');
      }
    }),

  /**
   * The preview run a publish approval was based on, fetched by version — it
   * stays reachable after the widget's run history rolls past the list
   * window, so old publish cards keep their body.
   */
  getPreviewRun: widgetProcedure
    .input(z.object({ versionId: uuid, widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetModel.findPreviewRun(input.widgetId, input.versionId);
        if (!data) throw notFound('Run');
        return { data, success: true };
      } catch (error) {
        fail(error, 'get widget preview run');
      }
    }),

  getVersion: widgetProcedure
    .input(z.object({ versionId: uuid, widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetModel.findVersion(input.widgetId, input.versionId);
        if (!data) throw notFound('Version');
        return { data, success: true };
      } catch (error) {
        fail(error, 'get widget version');
      }
    }),

  /** Widgets living directly on one level (personal / workspace, project, agent). */
  list: widgetProcedure.input(levelInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.widgetModel.list(input ?? {}), success: true };
    } catch (error) {
      fail(error, 'list widgets');
    }
  }),

  /** Every widget of a project, including those an agent of the project also owns. */
  listByProject: widgetProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return { data: await ctx.widgetModel.listByProject(input.projectId), success: true };
      } catch (error) {
        fail(error, 'list project widgets');
      }
    }),

  listRuns: widgetProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional(), widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        if (!(await ctx.widgetModel.findById(input.widgetId))) throw notFound('Widget');
        const data = await ctx.widgetModel.listRuns(input.widgetId, { limit: input.limit });
        return { data, success: true };
      } catch (error) {
        fail(error, 'list widget runs');
      }
    }),

  listVersions: widgetProcedure
    .input(z.object({ widgetId: uuid }))
    .query(async ({ ctx, input }) => {
      try {
        if (!(await ctx.widgetModel.findById(input.widgetId))) throw notFound('Widget');
        return { data: await ctx.widgetModel.listVersions(input.widgetId), success: true };
      } catch (error) {
        fail(error, 'list widget versions');
      }
    }),

  publish: widgetWriteProcedure
    .input(z.object({ versionId: uuid, widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.publish(input.widgetId, input.versionId);
        return { data, message: 'Version published', success: true };
      } catch (error) {
        fail(error, 'publish widget version');
      }
    }),

  restore: widgetWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetModel.restore(input.id);
      if (!data) throw notFound('Widget');
      return { data, message: 'Widget restored', success: true };
    } catch (error) {
      fail(error, 'restore widget');
    }
  }),

  /** Re-publish a previously published version (default: the one last replaced). */
  rollback: widgetWriteProcedure
    .input(z.object({ versionId: uuid.optional(), widgetId: uuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.widgetService.rollback(input.widgetId, input.versionId);
        return { data, message: 'Version rolled back', success: true };
      } catch (error) {
        fail(error, 'roll back widget version');
      }
    }),

  /** Refresh the published version now. */
  run: widgetWriteProcedure.input(z.object({ widgetId: uuid })).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetService.runNow(input.widgetId);
      return { data, message: `Run ${data?.status}`, success: true };
    } catch (error) {
      fail(error, 'run widget');
    }
  }),

  /** Record script + contract as the widget's draft; identical content reuses the draft. */
  saveDraft: widgetWriteProcedure
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
        fail(error, 'save widget draft');
      }
    }),

  /** Set (cron pattern) or clear (null) the refresh schedule. */
  setSchedule: widgetWriteProcedure
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
        fail(error, 'set widget schedule');
      }
    }),

  trash: widgetWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.widgetModel.trash(input.id);
      if (!data) throw notFound('Widget');
      return { data, message: 'Widget moved to trash', success: true };
    } catch (error) {
      fail(error, 'trash widget');
    }
  }),

  update: widgetWriteProcedure
    .input(
      z.object({
        id: uuid,
        value: z.object({
          description: z.string().max(2000).nullish(),
          metadata,
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
        fail(error, 'update widget');
      }
    }),
});
