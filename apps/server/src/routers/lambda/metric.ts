import type { MetricSubjectType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { GoalModel } from '@/database/models/goal';
import { MetricModel } from '@/database/models/metric';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const metricProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      metricModel: new MetricModel(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  }),
);
const metricWriteProcedure = metricProcedure.use(withScopedPermission('agent:update'));

const idInput = z.object({ id: z.string() });
const subjectInput = z.object({
  subjectId: z.string(),
  subjectType: z.enum(['goal', 'task', 'agent', 'project', 'workspace']),
});
const configSchema = z.object({
  direction: z.enum(['higher_is_better', 'lower_is_better']).optional(),
  // Values persist in numeric(20, 6); a higher declared precision would be
  // a promise the column silently rounds away.
  precision: z.number().int().min(0).max(6).optional(),
  sampleIntervalHint: z.string().optional(),
  target: z.number().optional(),
});
const definitionFields = {
  config: configSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  title: z.string().optional(),
  unit: z.string().optional(),
};
// These columns are nullable, so a patch must be able to clear them — dropping
// a target back to "no target" is an edit, not an omission. Omitted still
// means "leave as is"; explicit null means "unset".
const patchableDefinitionFields = {
  config: configSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  title: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
};

function mapMetricError(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  console.error(`[metric:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation} metric`,
  });
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Metric series not found' });

/**
 * A metric is telemetry *about* its subject, so it is exactly as visible as
 * that subject — the invariant every path here enforces.
 *
 * It has to be enforced here because the link is polymorphic with no FK and
 * `metrics` carries no `visibility` column of its own: in workspace mode
 * `buildWorkspaceWhere` degrades to a bare `workspace_id` match, which would
 * otherwise let any member read (or write) the series of a coworker's private
 * agent, task or project. On the write side it additionally stops a caller
 * minting series against arbitrary ids — durable dangling rows, and because
 * (subject_type, subject_id, key) is globally unique, a reserved slot the
 * legitimate owner could never claim.
 */
const assertSubjectVisible = async (
  db: LobeChatDatabase,
  ctx: { userId: string; workspaceId?: string | null },
  subjectType: MetricSubjectType,
  subjectId: string,
): Promise<void> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  const visible = await (() => {
    switch (subjectType) {
      case 'agent': {
        return new AgentModel(db, ctx.userId, workspaceId).existsById(subjectId);
      }
      case 'goal': {
        return new GoalModel(db, ctx.userId, workspaceId).findById(subjectId);
      }
      case 'project': {
        return new ProjectModel(db, ctx.userId, workspaceId).findById(subjectId);
      }
      case 'task': {
        return new TaskModel(db, ctx.userId, workspaceId).findById(subjectId);
      }
      case 'workspace': {
        return workspaceId === subjectId;
      }
    }
  })();
  if (!visible)
    throw new TRPCError({ code: 'NOT_FOUND', message: `Metric subject not found: ${subjectType}` });
};

/**
 * Load a series for a by-id path and re-check its subject: the series row
 * alone proves only workspace membership, not that the caller may see what it
 * measures. Doubles as orphan protection — a series whose subject was deleted
 * stops resolving instead of lingering as readable, writable telemetry.
 */
const requireVisibleSeries = async (
  db: LobeChatDatabase,
  ctx: { metricModel: MetricModel; userId: string; workspaceId?: string | null },
  id: string,
) => {
  const series = await ctx.metricModel.findById(id);
  if (!series) throw notFound();
  await assertSubjectVisible(db, ctx, series.subjectType, series.subjectId);
  return series;
};

export const metricRouter = router({
  /**
   * Append one observation. Actor attribution is server-set — a TRPC caller is
   * always the authenticated user; probe runs write through their own service
   * path with `system` attribution.
   */
  addPoint: metricWriteProcedure
    .input(
      idInput.extend({
        metadata: z.record(z.string(), z.unknown()).optional(),
        observedAt: z.coerce.date().optional(),
        sourceType: z.enum(['manual', 'api']).default('manual'),
        value: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await requireVisibleSeries(ctx.serverDB, ctx, input.id);
        const point = await ctx.metricModel.addPoint(input.id, {
          actorId: ctx.userId,
          actorType: 'user',
          metadata: input.metadata,
          observedAt: input.observedAt ?? new Date(),
          sourceType: input.sourceType,
          value: input.value,
        });
        if (!point) throw notFound();
        return { data: point, message: 'Point recorded', success: true };
      } catch (error) {
        mapMetricError(error, 'addPoint');
      }
    }),

  deleteSeries: metricWriteProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const series = await requireVisibleSeries(ctx.serverDB, ctx, input.id);
      // Workspace visibility lets any member read the series; deleting it (and
      // cascading every observation) stays with the creator or an owner.
      assertWorkspaceRowManageable(ctx, series.userId, 'metric series');
      const deleted = await ctx.metricModel.delete(input.id);
      if (!deleted) throw notFound();
      return { message: 'Series deleted', success: true };
    } catch (error) {
      mapMetricError(error, 'deleteSeries');
    }
  }),

  /** Series definition plus its latest observation — the "current value" read. */
  getSeries: metricProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const series = await requireVisibleSeries(ctx.serverDB, ctx, input.id);
      const latest = await ctx.metricModel.latestPoint(series.id);
      return { data: { ...series, latestPoint: latest ?? null }, success: true };
    } catch (error) {
      mapMetricError(error, 'getSeries');
    }
  }),

  /**
   * The chart read: raw or bucket-aggregated points together with the render
   * contract (kind / unit / config / title), so one call feeds a chart.
   */
  listPoints: metricProcedure
    .input(
      idInput.extend({
        bucket: z.enum(['hour', 'day', 'week', 'month']).optional(),
        from: z.coerce.date().optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
        to: z.coerce.date().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        await requireVisibleSeries(ctx.serverDB, ctx, input.id);
        const result = await ctx.metricModel.listPoints(input.id, {
          bucket: input.bucket,
          from: input.from,
          limit: input.limit,
          to: input.to,
        });
        if (!result) throw notFound();
        const { points, series } = result;
        return {
          data: {
            config: series.config,
            kind: series.kind,
            points,
            title: series.title,
            unit: series.unit,
          },
          success: true,
        };
      } catch (error) {
        mapMetricError(error, 'listPoints');
      }
    }),

  listSeries: metricProcedure.input(subjectInput).query(async ({ input, ctx }) => {
    try {
      await assertSubjectVisible(ctx.serverDB, ctx, input.subjectType, input.subjectId);
      const data = await ctx.metricModel.findBySubject(input.subjectType, input.subjectId);
      return { data, success: true };
    } catch (error) {
      mapMetricError(error, 'listSeries');
    }
  }),

  updateSeries: metricWriteProcedure
    .input(
      idInput.extend({
        ...patchableDefinitionFields,
        kind: z.enum(['gauge', 'counter']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { id, ...patch } = input;
        const existing = await requireVisibleSeries(ctx.serverDB, ctx, id);
        // Definition edits rewrite the render/evaluation contract for everyone
        // reading the series — creator or workspace owner only.
        assertWorkspaceRowManageable(ctx, existing.userId, 'metric series');
        const series = await ctx.metricModel.update(id, patch);
        if (!series) throw notFound();
        return { data: series, message: 'Series updated', success: true };
      } catch (error) {
        mapMetricError(error, 'updateSeries');
      }
    }),

  /** Idempotent create — existing definition fields are never overwritten. */
  upsertSeries: metricWriteProcedure
    .input(
      subjectInput.extend({
        ...definitionFields,
        key: z.string().min(1).max(255),
        kind: z.enum(['gauge', 'counter']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await assertSubjectVisible(ctx.serverDB, ctx, input.subjectType, input.subjectId);
        const series = await ctx.metricModel.ensure(input);
        if (!series)
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Metric series slot is owned by another scope',
          });
        return { data: series, message: 'Series ready', success: true };
      } catch (error) {
        mapMetricError(error, 'upsertSeries');
      }
    }),
});
