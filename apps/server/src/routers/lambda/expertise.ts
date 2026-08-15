import { z } from 'zod';

import { ExpertiseModel } from '@/database/models/expertise';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ExpertiseDomainService } from '@/server/services/expertise/domain';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { ExpertiseHistoryWorkflow } from '@/server/workflows/expertiseHistory';

import { recentLessonDelta } from './expertiseHelpers';

const expertiseProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      expertiseModel: new ExpertiseModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      expertiseDomainService: new ExpertiseDomainService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
      expertiseIngestionService: new ExpertiseIngestionService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

/** Exposes fitted maturity only when the model has enough trustworthy evidence. */
const toMaturity = (s?: {
  fitComputedAt: Date | null;
  fitConfidence: string | null;
  fitR2: number | null;
  fitSampleSize: number | null;
  maturity: number | null;
  observedSpan: number | null;
  pInf: number | null;
  plateauKind: string | null;
  tau: number | null;
  tauPinned: boolean;
}) => {
  if (!s) return { reason: 'no-data' as const, usable: false as const };
  if (!s.fitComputedAt) return { reason: 'pending' as const, usable: false as const };
  if (s.tauPinned) return { reason: 'tau-pinned' as const, usable: false as const };
  if (s.fitConfidence !== 'ok') {
    return {
      plateauKind: s.plateauKind,
      reason: 'low-confidence' as const,
      usable: false as const,
    };
  }
  return {
    fitR2: s.fitR2,
    fitSampleSize: s.fitSampleSize,
    maturity: s.maturity,
    /** Values below one mean the observed data does not yet constrain the asymptote. */
    observedSpan: s.observedSpan,
    pInf: s.pInf,
    plateauKind: s.plateauKind,
    speculative: (s.observedSpan ?? 0) < 1,
    tau: s.tau,
    usable: true as const,
  };
};

export const expertiseRouter = router({
  /** L0: all expertise available to an agent and its latest state. */
  listByAgent: expertiseProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const bound = await ctx.expertiseModel.listDomainsForAgent(input.agentId);
      const domainIds = bound.map((b) => b.domain.id);
      const [snapshots, actors, insights, series] = await Promise.all([
        ctx.expertiseModel.latestSnapshots(domainIds),
        ctx.expertiseModel.actorsByDomain(domainIds),
        ctx.expertiseModel.listInsights(domainIds),
        ctx.expertiseModel.seriesForDomains(domainIds),
      ]);
      const snapByDomain = new Map(snapshots.map((s) => [s.domainId, s]));
      const actorsByDomain = new Map<string, string[]>();
      for (const a of actors) {
        actorsByDomain.set(a.domainId, [...(actorsByDomain.get(a.domainId) ?? []), a.actorId]);
      }
      const seriesByDomain = new Map<string, { n: number; run: number }[]>();
      for (const s of series) {
        seriesByDomain.set(s.domainId, [
          ...(seriesByDomain.get(s.domainId) ?? []),
          { n: s.activeCount, run: s.runIndex },
        ]);
      }

      const domains = bound.map(({ binding, domain }) => {
        const snap = snapByDomain.get(domain.id);
        const points = seriesByDomain.get(domain.id) ?? [];
        // Net change over the latest five runs distinguishes growth, retirement, and no learning.
        const delta = recentLessonDelta(points);
        return {
          activeRate: snap?.activeRate ?? null,
          actors: actorsByDomain.get(domain.id) ?? [],
          canonCoverage: snap?.canonCoverage ?? null,
          contributionMode: binding.contributionMode,
          delta,
          id: domain.id,
          /** Timestamp of the latest practice run. */
          lastPracticedAt: snap?.capturedAt ?? null,
          layerCounts: snap?.layerCounts ?? {},
          layerCoverage: snap?.layerCoverage ?? null,
          layers: domain.layers,
          layerSource: domain.layerSource,
          lessonCount: snap?.activeCount ?? 0,
          maturity: toMaturity(snap),
          runCount: snap?.runIndex ?? 0,
          /** Series used by the overlaid maturity chart. */
          series: points,
          slug: domain.slug,
          title: domain.title,
        };
      });

      return {
        domains,
        insights,
        totals: {
          domains: domains.length,
          lessons: domains.reduce((a, d) => a + d.lessonCount, 0),
        },
      };
    }),

  /** L1: the complete SCLPT domain state and time series. */
  getDomain: expertiseProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      const domain = await ctx.expertiseModel.findDomain(input.domainId);
      if (!domain) return null;

      const [snapshots, runCount, humanFlags, lessonStats, layerCounts, canon] = await Promise.all([
        ctx.expertiseModel.listSnapshots(input.domainId),
        ctx.expertiseModel.countRuns(input.domainId),
        ctx.expertiseModel.runHumanFlags(input.domainId),
        ctx.expertiseModel.lessonStats(input.domainId),
        ctx.expertiseModel.layerCounts(input.domainId),
        ctx.expertiseModel.canonAnchorCounts(input.domainId),
      ]);
      const humanByRun = new Map(humanFlags.map((r) => [r.runIndex, r.hadHumanInLoop]));
      const latest = snapshots.at(-1);
      // Tail gain measures recent quantity while plateauKind describes the curve shape.
      const tail = snapshots.slice(-6);
      const tailGain = tail.length > 1 ? tail.at(-1)!.activeCount - tail[0].activeCount : 0;

      return {
        canonAnchorCounts: canon.byKey,
        domain,
        layerCounts,
        lessonStats,
        maturity: toMaturity(latest),
        runCount,
        /** The chart receives only the snapshot fields it renders. */
        series: snapshots.map((s) => ({
          activeCount: s.activeCount,
          compiledCount: s.compiledCount,
          /** Controls whether the chart marks this run as human-assisted. */
          hadHumanInLoop: humanByRun.get(s.runIndex) ?? false,
          runIndex: s.runIndex,
        })),
        tailGain,
        unanchoredCount: canon.unanchored,
      };
    }),

  /** L2: lessons ordered by hits with server-computed usage tiers. */
  listLessons: expertiseProcedure
    .input(
      z.object({
        domainId: z.string(),
        layer: z.string().optional(),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const domain = await ctx.expertiseModel.findDomain(input.domainId);
      if (!domain) return [];
      return ctx.expertiseModel.listLessons(input.domainId, {
        layer: input.layer,
        search: input.search,
      });
    }),

  /** L3: one lesson together with its supporting and violating examples. */
  getLesson: expertiseProcedure
    .input(z.object({ lessonId: z.string() }))
    .query(async ({ ctx, input }) => {
      const lesson = await ctx.expertiseModel.findLesson(input.lessonId);
      if (!lesson) return null;
      const hits = await ctx.expertiseModel.listLessonHits(input.lessonId);
      return { hits, lesson };
    }),

  /** Creates an expertise domain from a natural-language brief. */
  createDomain: expertiseProcedure
    .input(
      z.object({
        agentId: z.string(),
        brief: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.expertiseDomainService.createFromBrief(input)),

  /** Explicitly bootstraps expertise from conversations that existed before the domain did. */
  ingestHistory: expertiseProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const candidateCount = await ctx.expertiseIngestionService.countHistoricalTopics(
        input.agentId,
      );
      if (candidateCount === 0) return { candidateCount, workflowRunId: null };

      const { workflowRunId } = await ExpertiseHistoryWorkflow.trigger({
        agentId: input.agentId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { candidateCount, workflowRunId };
    }),

  /** Dismisses an incorrect generated insight. */
  dismissInsight: expertiseProcedure
    .input(z.object({ insightId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.expertiseModel.dismissInsight(input.insightId, input.reason);
    }),
});
