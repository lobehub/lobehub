import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MetricModel } from '@/database/models/metric';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

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
  precision: z.number().int().min(0).max(8).optional(),
  sampleIntervalHint: z.string().optional(),
  target: z.number().optional(),
});
const definitionFields = {
  config: configSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  title: z.string().optional(),
  unit: z.string().optional(),
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
      await ctx.metricModel.delete(input.id);
      return { message: 'Series deleted', success: true };
    } catch (error) {
      mapMetricError(error, 'deleteSeries');
    }
  }),

  /** Series definition plus its latest observation — the "current value" read. */
  getSeries: metricProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const series = await ctx.metricModel.findById(input.id);
      if (!series) throw notFound();
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
      const data = await ctx.metricModel.findBySubject(input.subjectType, input.subjectId);
      return { data, success: true };
    } catch (error) {
      mapMetricError(error, 'listSeries');
    }
  }),

  updateSeries: metricWriteProcedure
    .input(idInput.extend({ ...definitionFields, kind: z.enum(['gauge', 'counter']).optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { id, ...patch } = input;
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
