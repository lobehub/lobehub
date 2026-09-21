import { EXPERTISE_ENFORCEMENTS } from '@lobechat/types';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { ExpertiseModel } from '@/database/models/expertise';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  DomainDraftSchema,
  EditableDomainDraftSchema,
  ExpertiseDomainService,
} from '@/server/services/expertise/domain';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { ExpertiseHistoryWorkflow } from '@/server/workflows/expertiseHistory';

/**
 * Workspace-scoped like every other content router: `wsCompatProcedure` resolves and
 * authorizes `X-Workspace-Id` (membership in the cloud build), so the models below only
 * ever see a workspace the caller actually belongs to.
 */
const expertiseProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
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

/** Anything that changes what the agent learns needs at least member standing in the workspace. */
const expertiseWriteProcedure = expertiseProcedure.use(requireWorkspaceRoleWhenScoped('member'));

export const expertiseRouter = router({
  /**
   * L0: the growth portrait — every bound domain with its habits (active lessons + recent
   * outcomes), the cumulative-learned series, and the per-run reliability series.
   * Reliability tiers are folded on the client so one pure helper owns the thresholds.
   */
  listByAgent: expertiseProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const bound = await ctx.expertiseModel.listDomainsForAgent(input.agentId);
      const domainIds = bound.map((b) => b.domain.id);
      const [snapshots, series, reliability, lessons] = await Promise.all([
        ctx.expertiseModel.latestSnapshots(domainIds),
        ctx.expertiseModel.seriesForDomains(domainIds),
        ctx.expertiseModel.reliabilitySeries(domainIds),
        ctx.expertiseModel.listLessonsWithRecent(domainIds),
      ]);
      const snapByDomain = new Map(snapshots.map((s) => [s.domainId, s]));
      const seriesByDomain = new Map<string, { n: number; run: number }[]>();
      for (const s of series) {
        seriesByDomain.set(s.domainId, [
          ...(seriesByDomain.get(s.domainId) ?? []),
          { n: s.activeCount, run: s.runIndex },
        ]);
      }
      const reliabilityByDomain = new Map<
        string,
        { pass: number; run: number; violation: number }[]
      >();
      for (const r of reliability) {
        reliabilityByDomain.set(r.domainId, [
          ...(reliabilityByDomain.get(r.domainId) ?? []),
          { pass: r.pass, run: r.runIndex, violation: r.violation },
        ]);
      }
      const lessonsByDomain = new Map<string, typeof lessons>();
      for (const l of lessons) {
        lessonsByDomain.set(l.domainId, [...(lessonsByDomain.get(l.domainId) ?? []), l]);
      }

      const domains = bound.map(({ domain }) => {
        const snap = snapByDomain.get(domain.id);
        return {
          canonEntries: domain.canonEntries,
          domainFilter: domain.domainFilter,
          id: domain.id,
          lastPracticedAt: snap?.capturedAt ?? null,
          layerCanonRef: domain.anchorCandidates?.[0]?.layerCanonRef ?? null,
          layers: domain.layers,
          layerSource: domain.layerSource,
          lessons: (lessonsByDomain.get(domain.id) ?? []).map((l) => ({
            code: l.code,
            createdAt: l.createdAt,
            hitCount: l.hitCount,
            id: l.id,
            lastHitAt: l.lastHitAt,
            layer: l.layer,
            recent: l.recent,
            taughtByUser: l.taughtByUser,
            title: l.title,
          })),
          outOfScope: domain.outOfScope,
          reliability: reliabilityByDomain.get(domain.id) ?? [],
          runCount: snap?.runIndex ?? 0,
          series: seriesByDomain.get(domain.id) ?? [],
          title: domain.title,
        };
      });

      return { domains };
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
          learnedTotal: s.learnedTotal,
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

  /**
   * The reviewer's own rules, grouped, plus how many rejected rounds are still waiting to be
   * read. The backlog travels with the list because an empty page has to say *why* it is empty —
   * distillation only fires when a later round lands, so old rejections never arrive on their own.
   */
  listRules: expertiseProcedure.query(async ({ ctx }) => {
    const [groups, backlogRounds] = await Promise.all([
      ctx.expertiseModel.listRules(),
      ctx.expertiseModel.countUndistilledRejectionRounds(),
    ]);
    return { backlogRounds, groups };
  }),

  /** The rejections one rule was distilled from, linked back to the acceptance round. */
  ruleSources: expertiseProcedure
    .input(z.object({ lessonId: z.string() }))
    .query(async ({ ctx, input }) => ctx.expertiseModel.listLessonSources(input.lessonId)),

  /** The edits one rule has been through, so a reader can see who narrowed it and when. */
  ruleRevisions: expertiseProcedure
    .input(z.object({ lessonId: z.string() }))
    .query(async ({ ctx, input }) => ctx.expertiseModel.listLessonRevisions(input.lessonId)),

  /** A rule the reviewer writes down by hand. */
  createRule: expertiseWriteProcedure
    .input(
      z.object({
        body: z.string().max(4000).optional(),
        compilability: z.enum(['compiled', 'compilable', 'not-compilable']).optional(),
        domainId: z.string(),
        enforcement: z.enum(EXPERTISE_ENFORCEMENTS).optional(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.createRule(input)),

  /** Field-level edits from the rule document; wording edits are versioned. */
  updateRule: expertiseWriteProcedure
    .input(
      z.object({
        compilability: z.enum(['compiled', 'compilable', 'not-compilable']).optional(),
        enforcement: z.enum(EXPERTISE_ENFORCEMENTS).optional(),
        lessonId: z.string(),
        reasonKind: z.enum(['mechanism', 'taste']).optional(),
        sections: z
          .object({
            how: z.string().max(8000).nullable().optional(),
            limits: z.string().max(4000).nullable().optional(),
            rule: z.string().max(4000).nullable().optional(),
            why: z.string().max(4000).nullable().optional(),
          })
          .optional(),
        title: z.string().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lessonId, ...patch } = input;
      return ctx.expertiseModel.updateRule(lessonId, patch);
    }),

  /** The order the reviewer dragged one group into. */
  reorderRules: expertiseWriteProcedure
    .input(z.object({ domainId: z.string(), lessonIds: z.array(z.string()).max(500) }))
    .mutation(async ({ ctx, input }) =>
      ctx.expertiseModel.reorderRules(input.domainId, input.lessonIds),
    ),

  /** Files a rule under another group. */
  moveRule: expertiseWriteProcedure
    .input(z.object({ domainId: z.string(), lessonId: z.string() }))
    .mutation(async ({ ctx, input }) =>
      ctx.expertiseModel.moveRule(input.lessonId, input.domainId),
    ),

  /** Folds one rule into another; the source is archived with a pointer to where it went. */
  mergeRules: expertiseWriteProcedure
    .input(z.object({ fromId: z.string(), intoId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.mergeRules(input.fromId, input.intoId)),

  /** Puts an archived rule back into practice. */
  restoreLesson: expertiseWriteProcedure
    .input(z.object({ lessonId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.restoreLesson(input.lessonId)),

  /** A group the reviewer opens by hand; it mounts on them, so every acceptance can add to it. */
  createRuleGroup: expertiseWriteProcedure
    .input(z.object({ gate: z.string().min(1).max(1000), title: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.createRuleGroup(input)),

  /** Renames a group or rewrites its gate question. */
  updateRuleGroup: expertiseWriteProcedure
    .input(
      z.object({
        domainId: z.string(),
        gate: z.string().min(1).max(1000).optional(),
        title: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { domainId, ...patch } = input;
      return ctx.expertiseModel.updateRuleGroup(domainId, patch);
    }),

  /** Step 1 of creation: interpret the brief into an editable draft. Nothing is persisted. */
  draftDomain: expertiseWriteProcedure
    .input(
      z.object({
        adjustment: z.string().min(1).max(2000).optional(),
        agentId: z.string(),
        brief: z.string().min(1),
        currentDraft: EditableDomainDraftSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.expertiseDomainService.draftFromBrief(input)),

  /** Step 2 of creation: persist the reviewed anchor and bind it to the agent. */
  createDomain: expertiseWriteProcedure
    .input(DomainDraftSchema.extend({ agentId: z.string(), brief: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ctx.expertiseDomainService.create(input)),

  /** The user drops a direction; everything learned in it goes with it. */
  deleteDomain: expertiseWriteProcedure
    .input(z.object({ domainId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.deleteDomain(input.domainId)),

  /** How many past conversations a history warm-up would read. */
  countHistory: expertiseProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => ({
      candidateCount: await ctx.expertiseIngestionService.countHistoricalTopics(input.agentId),
    })),

  /** The user teaches one lesson directly, in their own words. */
  teachLesson: expertiseWriteProcedure
    .input(z.object({ domainId: z.string(), text: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.expertiseModel.teachLesson({ domainId: input.domainId, text: input.text }),
    ),

  /** The user corrects a lesson; the correction is versioned and joins the lesson body. */
  reviseLesson: expertiseWriteProcedure
    .input(z.object({ lessonId: z.string(), text: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.expertiseModel.reviseLesson(input.lessonId, input.text),
    ),

  /** The user asks it to forget a lesson. */
  retireLesson: expertiseWriteProcedure
    .input(z.object({ lessonId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.expertiseModel.retireLesson(input.lessonId)),

  /** Explicitly bootstraps expertise from conversations that existed before the domain did. */
  ingestHistory: expertiseWriteProcedure
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
  dismissInsight: expertiseWriteProcedure
    .input(z.object({ insightId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.expertiseModel.dismissInsight(input.insightId, input.reason);
    }),
});
