import { z } from 'zod';

import { ExpertiseModel } from '@/database/models/expertise';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { ExpertiseHistoryWorkflow } from '@/server/workflows/expertiseHistory';

import { recentLessonDelta } from './expertiseHelpers';

const expertiseProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      expertiseModel: new ExpertiseModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      expertiseIngestionService: new ExpertiseIngestionService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

/**
 * 拟合结果只有在可信时才交给界面。
 *
 * 有三种「没有成熟度」，界面文案各不相同：
 *   fitComputedAt 为空       → 还在算
 *   fitConfidence 非 ok      → 样本太少 / 噪声 / 拟合失败，算不出
 *   tauPinned                → τ 撞了搜索上界，pInf 是边界伪影
 * 任何一种都不能给出百分比 —— 9 组回测里 6 组撞界，旧版把它们全报成了 ok。
 */
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
    /** < 1 表示还没观测满一个时间常数，渐近线没被数据约束住，外推只是猜测。 */
    observedSpan: s.observedSpan,
    pInf: s.pInf,
    plateauKind: s.plateauKind,
    speculative: (s.observedSpan ?? 0) < 1,
    tau: s.tau,
    usable: true as const,
  };
};

export const expertiseRouter = router({
  /** L0 —— 一个 agent 能用到的全部专长 + 各自最新状态。 */
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
        // 最近 5 次的净变化：涨=在长，跌=规则被退休（能力在退），0=练了没学到
        const delta = recentLessonDelta(points);
        return {
          activeRate: snap?.activeRate ?? null,
          actors: actorsByDomain.get(domain.id) ?? [],
          canonCoverage: snap?.canonCoverage ?? null,
          contributionMode: binding.contributionMode,
          delta,
          id: domain.id,
          /** 最近一次实践的时间 —— 用来判断这个专长是不是闲置了。 */
          lastPracticedAt: snap?.capturedAt ?? null,
          layerCounts: snap?.layerCounts ?? {},
          layerCoverage: snap?.layerCoverage ?? null,
          layers: domain.layers,
          layerSource: domain.layerSource,
          lessonCount: snap?.activeCount ?? 0,
          maturity: toMaturity(snap),
          runCount: snap?.runIndex ?? 0,
          /** 叠图用的曲线；纵轴是成熟度比例，所以 pInf 也要一起给。 */
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

  /** L1 —— 一个专长的完整状态：SCLPT 五要素 + 时间序列。 */
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
      // 后段还在涨多少：最后五次的净增。plateauKind 说的是形状，这个说的是量。
      const tail = snapshots.slice(-6);
      const tailGain = tail.length > 1 ? tail.at(-1)!.activeCount - tail[0].activeCount : 0;

      return {
        canonAnchorCounts: canon.byKey,
        domain,
        layerCounts,
        lessonStats,
        maturity: toMaturity(latest),
        runCount,
        /** 曲线只需要这几列，别把整行快照塞给前端。 */
        series: snapshots.map((s) => ({
          activeCount: s.activeCount,
          compiledCount: s.compiledCount,
          /** 那一次有没有人在对话里 —— 图上柱子的颜色。 */
          hadHumanInLoop: humanByRun.get(s.runIndex) ?? false,
          runIndex: s.runIndex,
        })),
        tailGain,
        unanchoredCount: canon.unanchored,
      };
    }),

  /** L2 —— 规则库，按命中排，梯队在服务端算好。 */
  listLessons: expertiseProcedure
    .input(
      z.object({
        domainId: z.string(),
        layer: z.string().optional(),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.expertiseModel.listLessons(input.domainId, {
        layer: input.layer,
        search: input.search,
      }),
    ),

  /** L3 —— 单条规则，带上它的 ✅❌ 例子。 */
  getLesson: expertiseProcedure
    .input(z.object({ lessonId: z.string() }))
    .query(async ({ ctx, input }) => {
      const lesson = await ctx.expertiseModel.findLesson(input.lessonId);
      if (!lesson) return null;
      const hits = await ctx.expertiseModel.listLessonHits(input.lessonId);
      return { hits, lesson };
    }),

  /** 人手建一个专长 —— 空态那个按钮打进来的。 */
  createDomain: expertiseProcedure
    .input(
      z.object({
        agentId: z.string(),
        brief: z.string().min(1),
        domainFilter: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.createDomain(input)),

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

  /** 洞察是分析产物，会出错 —— 必须能被否掉。 */
  dismissInsight: expertiseProcedure
    .input(z.object({ insightId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.expertiseModel.dismissInsight(input.insightId, input.reason);
    }),
});
