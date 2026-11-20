import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseInsights,
  expertiseLessons,
  expertiseRuns,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { domainScopeWhere, type ExpertiseArgs, type ExpertiseContext } from './context';
import * as domains from './domains';
import * as filing from './filing';
import * as lessons from './lessons';
import * as lineage from './lineage';
import * as rules from './rules';

export type { ExpertiseCarrier } from './domains';
export type { ExpertiseGroupOwner } from './rules';

/** The core tier starts at 40% of the domain's maximum hit count, with a floor of two. */
const CORE_CUT_RATIO = 0.4;
const CORE_CUT_MIN = 2;

export type ExpertiseTier = 'core' | 'niche' | 'unused';

/**
 * Runs that observed practice: a material the reviewer distilled (`reflectionKey` `material:…`)
 * records the passages a rule was read from, which are not outcomes of applying it.
 */
const notMaterialRun = () =>
  sql`coalesce(${expertiseRuns.reflectionKey}, '') not like 'material:%'`;

export class ExpertiseModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;
  private ctx: ExpertiseContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.ctx = { db, model: this, userId, workspaceId };
  }

  private scopeWhere = () => domainScopeWhere(this.ctx);

  private insightScopeWhere = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, expertiseInsights);

  // Binding resolution

  /** Lists the agent-level and workspace-level expertise available to one authorized agent. */
  listDomainsForAgent = async (agentId: string) => {
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .limit(1);
    if (!agent) return [];

    return this.listDomainsBoundTo(eq(expertiseBindings.agentId, agentId));
  };

  /**
   * Lists the expertise mounted on one project, plus the caller's own always-on domains.
   *
   * Deliberately does not verify the project row: the caller reaches this through an acceptance
   * it already owns, and `scopeWhere` still confines the result to domains in scope.
   */
  listDomainsForProject = async (projectId: string) =>
    this.listDomainsBoundTo(eq(expertiseBindings.projectId, projectId));

  /** The caller's always-on domains only — the scope an acceptance without a project falls back to. */
  listDomainsForOwner = async () => this.listDomainsBoundTo();

  private listDomainsBoundTo = (...args: ExpertiseArgs<typeof domains.listDomainsBoundTo>) =>
    domains.listDomainsBoundTo(this.ctx, ...args);

  // L0: overview

  /** Returns the latest snapshot for every requested domain. */
  latestSnapshots = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .selectDistinctOn([expertiseDomainSnapshots.domainId])
      .from(expertiseDomainSnapshots)
      .where(inArray(expertiseDomainSnapshots.domainId, domainIds))
      .orderBy(desc(expertiseDomainSnapshots.domainId), desc(expertiseDomainSnapshots.runIndex));
  };

  /** Loads the complete active-lesson series for all requested domains in one query. */
  seriesForDomains = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .select({
        activeCount: expertiseDomainSnapshots.activeCount,
        domainId: expertiseDomainSnapshots.domainId,
        runIndex: expertiseDomainSnapshots.runIndex,
      })
      .from(expertiseDomainSnapshots)
      .where(inArray(expertiseDomainSnapshots.domainId, domainIds))
      .orderBy(asc(expertiseDomainSnapshots.domainId), asc(expertiseDomainSnapshots.runIndex));
  };

  /**
   * Per-run pass/violation counts — the reliability series behind the "做对率" chart.
   * A run without hits produces no row; callers treat missing runs as "nothing to judge".
   * A material the reviewer distilled is not practice: its quotes are evidence the rule exists,
   * not a run that got it right, so they never count as passes.
   */
  reliabilitySeries = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .select({
        domainId: expertiseHits.domainId,
        pass: sql<number>`count(*) filter (where ${expertiseHits.outcome} = 'pass')::int`,
        runIndex: expertiseRuns.runIndex,
        violation: sql<number>`count(*) filter (where ${expertiseHits.outcome} = 'violation')::int`,
      })
      .from(expertiseHits)
      .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
      .where(and(inArray(expertiseHits.domainId, domainIds), notMaterialRun()))
      .groupBy(expertiseHits.domainId, expertiseRuns.runIndex)
      .orderBy(asc(expertiseHits.domainId), asc(expertiseRuns.runIndex));
  };

  listRules = (...args: ExpertiseArgs<typeof rules.listRules>) =>
    rules.listRules(this.ctx, ...args);

  listLessonSources = (...args: ExpertiseArgs<typeof lineage.listLessonSources>) =>
    lineage.listLessonSources(this.ctx, ...args);

  countUndistilledRejectionRounds = (
    ...args: ExpertiseArgs<typeof rules.countUndistilledRejectionRounds>
  ) => rules.countUndistilledRejectionRounds(this.ctx, ...args);

  /**
   * Active lessons for the portrait, each with its most recent hit outcomes (newest last).
   * Recent outcomes are what the client folds into a reliability tier; the topic title of each
   * hit lets the row say *where* it last went wrong without another query.
   * Material quotes are left out for the same reason as in {@link reliabilitySeries}.
   */
  listLessonsWithRecent = async (domainIds: string[], recentLimit = 6) => {
    if (domainIds.length === 0) return [];
    const lessons = await this.db
      .select({
        code: expertiseLessons.code,
        createdAt: expertiseLessons.createdAt,
        createdByUserId: expertiseLessons.createdByUserId,
        domainId: expertiseLessons.domainId,
        hitCount: expertiseLessons.hitCount,
        id: expertiseLessons.id,
        lastHitAt: expertiseLessons.lastHitAt,
        layer: expertiseLessons.layer,
        originRunId: expertiseLessons.originRunId,
        title: expertiseLessons.title,
      })
      .from(expertiseLessons)
      .where(
        and(inArray(expertiseLessons.domainId, domainIds), eq(expertiseLessons.status, 'active')),
      )
      .orderBy(desc(expertiseLessons.hitCount), asc(expertiseLessons.code));

    const ranked = this.db.$with('ranked').as(
      this.db
        .select({
          lessonId: expertiseHits.lessonId,
          outcome: expertiseHits.outcome,
          rn: sql<number>`row_number() over (partition by ${expertiseHits.lessonId} order by ${expertiseRuns.runIndex} desc, ${expertiseHits.createdAt} desc)`.as(
            'rn',
          ),
          runIndex: expertiseRuns.runIndex,
          subjectId: expertiseRuns.subjectId,
          subjectType: expertiseRuns.subjectType,
        })
        .from(expertiseHits)
        .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
        .where(and(inArray(expertiseHits.domainId, domainIds), notMaterialRun())),
    );
    const recentRows = await this.db
      .with(ranked)
      .select({
        lessonId: ranked.lessonId,
        outcome: ranked.outcome,
        rn: ranked.rn,
        runIndex: ranked.runIndex,
        subjectId: ranked.subjectId,
        subjectTitle: topics.title,
        subjectType: ranked.subjectType,
      })
      .from(ranked)
      .leftJoin(topics, and(eq(ranked.subjectType, 'topic'), eq(topics.id, ranked.subjectId)))
      .where(sql`${ranked.rn} <= ${recentLimit}`)
      .orderBy(asc(ranked.lessonId), desc(ranked.rn));

    const recentByLesson = new Map<
      string,
      {
        pass: boolean;
        runIndex: number;
        subjectId: string;
        subjectTitle: string | null;
        subjectType: string;
      }[]
    >();
    for (const r of recentRows) {
      const list = recentByLesson.get(r.lessonId) ?? [];
      list.push({
        pass: r.outcome === 'pass',
        runIndex: r.runIndex,
        subjectId: r.subjectId,
        subjectTitle: r.subjectTitle,
        subjectType: r.subjectType,
      });
      recentByLesson.set(r.lessonId, list);
    }
    return lessons.map(({ createdByUserId, originRunId, ...l }) => ({
      ...l,
      recent: recentByLesson.get(l.id) ?? [],
      /**
       * Taught by the user directly, as opposed to distilled from practice. Older ingestion
       * runs stamped the acting user on distilled lessons too, so a lesson that traces back to
       * a run is never "taught", whoever created the row.
       */
      taughtByUser: createdByUserId != null && originRunId == null,
    }));
  };

  /** Lists the agents that have practiced each domain. */
  actorsByDomain = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .selectDistinct({ actorId: expertiseRuns.actorId, domainId: expertiseRuns.domainId })
      .from(expertiseRuns)
      .where(and(inArray(expertiseRuns.domainId, domainIds), eq(expertiseRuns.actorType, 'agent')));
  };

  sameReach = (...args: ExpertiseArgs<typeof domains.sameReach>) =>
    domains.sameReach(this.ctx, ...args);

  // L1: domain detail

  findDomain = (...args: ExpertiseArgs<typeof domains.findDomain>) =>
    domains.findDomain(this.ctx, ...args);

  /** Returns the complete snapshot series for a domain. */
  listSnapshots = async (domainId: string) =>
    this.db
      .select()
      .from(expertiseDomainSnapshots)
      .where(eq(expertiseDomainSnapshots.domainId, domainId))
      .orderBy(asc(expertiseDomainSnapshots.runIndex));

  listRuns = async (domainId: string, limit = 50) =>
    this.db
      .select()
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, domainId))
      .orderBy(desc(expertiseRuns.runIndex))
      .limit(limit);

  /** Counts all runs independently of the paginated run list. */
  countRuns = async (domainId: string) => {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, domainId));
    return row?.n ?? 0;
  };

  /** Returns whether a human participated in each practice run. */
  runHumanFlags = async (domainId: string) =>
    this.db
      .select({
        hadHumanInLoop: expertiseRuns.hadHumanInLoop,
        runIndex: expertiseRuns.runIndex,
      })
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, domainId))
      .orderBy(asc(expertiseRuns.runIndex));

  /** Summarizes active lesson count, hits, and unused lessons. */
  lessonStats = async (domainId: string) => {
    const [row] = await this.db
      .select({
        hits: sql<number>`coalesce(sum(${expertiseLessons.hitCount}), 0)::int`,
        total: sql<number>`count(*)::int`,
        unused: sql<number>`count(*) filter (where ${expertiseLessons.hitCount} = 0)::int`,
      })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')));
    return row ?? { hits: 0, total: 0, unused: 0 };
  };

  // L2: lesson library

  /** Lists active lessons by hit count and assigns their usage tier. */
  listLessons = async (domainId: string, opts?: { layer?: string; search?: string }) => {
    const conditions = [
      eq(expertiseLessons.domainId, domainId),
      eq(expertiseLessons.status, 'active'),
    ];
    if (opts?.layer) conditions.push(eq(expertiseLessons.layer, opts.layer));
    if (opts?.search) {
      conditions.push(sql`${expertiseLessons.title} ILIKE ${`%${opts.search}%`}`);
    }

    const rows = await this.db
      .select({ lesson: expertiseLessons })
      .from(expertiseLessons)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
      .where(and(...conditions, this.scopeWhere()))
      .orderBy(desc(expertiseLessons.hitCount), asc(expertiseLessons.code));

    const lessons = rows.map(({ lesson }) => lesson);

    const maxHit = lessons.reduce((a, r) => Math.max(a, r.hitCount), 0);
    const cut = Math.max(CORE_CUT_MIN, Math.round(maxHit * CORE_CUT_RATIO));

    return lessons.map((r) => ({
      ...r,
      tier: (r.hitCount >= cut ? 'core' : r.hitCount > 0 ? 'niche' : 'unused') as ExpertiseTier,
    }));
  };

  /** Counts active lessons by declared layer. */
  layerCounts = async (domainId: string) => {
    const rows = await this.db
      .select({ layer: expertiseLessons.layer, n: sql<number>`count(*)::int` })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')))
      .groupBy(expertiseLessons.layer);
    return Object.fromEntries(rows.filter((r) => r.layer).map((r) => [r.layer!, r.n]));
  };

  /** Counts active lessons by canon anchor, including unanchored lessons. */
  canonAnchorCounts = async (domainId: string) => {
    const rows = await this.db
      .select({ anchor: expertiseLessons.canonAnchor, n: sql<number>`count(*)::int` })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')))
      .groupBy(expertiseLessons.canonAnchor);
    return {
      byKey: Object.fromEntries(rows.filter((r) => r.anchor).map((r) => [r.anchor!, r.n])),
      unanchored: rows.find((r) => !r.anchor)?.n ?? 0,
    };
  };

  // L3: lesson detail

  findLesson = (...args: ExpertiseArgs<typeof lessons.findLesson>) =>
    lessons.findLesson(this.ctx, ...args);

  /** Lists lesson evidence together with its source run and topic. */
  listLessonHits = async (lessonId: string, limit = 20) =>
    this.db
      .select({
        createdAt: expertiseHits.createdAt,
        example: expertiseHits.example,
        note: expertiseHits.note,
        outcome: expertiseHits.outcome,
        runIndex: expertiseRuns.runIndex,
        runTitle: sql<string>`coalesce(${topics.title}, ${expertiseRuns.subjectId})`,
        severity: expertiseHits.severity,
        subjectId: expertiseRuns.subjectId,
        subjectType: expertiseRuns.subjectType,
        where: expertiseHits.where,
      })
      .from(expertiseHits)
      .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseHits.domainId))
      .leftJoin(
        topics,
        and(eq(expertiseRuns.subjectType, 'topic'), eq(topics.id, expertiseRuns.subjectId)),
      )
      .where(and(eq(expertiseHits.lessonId, lessonId), this.scopeWhere()))
      .orderBy(desc(expertiseHits.createdAt))
      .limit(limit);

  // Writes

  createDomain = (...args: ExpertiseArgs<typeof domains.createDomain>) =>
    domains.createDomain(this.ctx, ...args);

  deleteDomain = (...args: ExpertiseArgs<typeof domains.deleteDomain>) =>
    domains.deleteDomain(this.ctx, ...args);

  teachLesson = (...args: ExpertiseArgs<typeof lessons.teachLesson>) =>
    lessons.teachLesson(this.ctx, ...args);

  reviseLesson = (...args: ExpertiseArgs<typeof lessons.reviseLesson>) =>
    lessons.reviseLesson(this.ctx, ...args);

  listLessonRevisions = (...args: ExpertiseArgs<typeof lessons.listLessonRevisions>) =>
    lessons.listLessonRevisions(this.ctx, ...args);

  restoreLesson = (...args: ExpertiseArgs<typeof lessons.restoreLesson>) =>
    lessons.restoreLesson(this.ctx, ...args);

  createRule = (...args: ExpertiseArgs<typeof filing.createRule>) =>
    filing.createRule(this.ctx, ...args);

  insertMaterialRun = (...args: ExpertiseArgs<typeof filing.insertMaterialRun>) =>
    filing.insertMaterialRun(this.ctx, ...args);

  insertMaterialHit = (...args: ExpertiseArgs<typeof filing.insertMaterialHit>) =>
    filing.insertMaterialHit(this.ctx, ...args);

  lockLesson = (...args: ExpertiseArgs<typeof lessons.lockLesson>) =>
    lessons.lockLesson(this.ctx, ...args);

  insertLessonRevision = (...args: ExpertiseArgs<typeof lessons.insertLessonRevision>) =>
    lessons.insertLessonRevision(this.ctx, ...args);

  updateLessonFields = (...args: ExpertiseArgs<typeof lessons.updateLessonFields>) =>
    lessons.updateLessonFields(this.ctx, ...args);

  fillLessonDirections = (...args: ExpertiseArgs<typeof lessons.fillLessonDirections>) =>
    lessons.fillLessonDirections(this.ctx, ...args);

  countLineageRuns = (...args: ExpertiseArgs<typeof lineage.countLineageRuns>) =>
    lineage.countLineageRuns(this.ctx, ...args);

  reorderRule = (...args: ExpertiseArgs<typeof filing.reorderRule>) =>
    filing.reorderRule(this.ctx, ...args);

  moveRule = (...args: ExpertiseArgs<typeof filing.moveRule>) => filing.moveRule(this.ctx, ...args);

  createRuleGroup = (...args: ExpertiseArgs<typeof domains.createRuleGroup>) =>
    domains.createRuleGroup(this.ctx, ...args);

  updateRuleGroup = (...args: ExpertiseArgs<typeof domains.updateRuleGroup>) =>
    domains.updateRuleGroup(this.ctx, ...args);

  retireLesson = (...args: ExpertiseArgs<typeof lessons.retireLesson>) =>
    lessons.retireLesson(this.ctx, ...args);

  // Insights

  listInsights = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .select()
      .from(expertiseInsights)
      .where(
        and(
          or(inArray(expertiseInsights.domainId, domainIds), isNull(expertiseInsights.domainId)),
          eq(expertiseInsights.status, 'active'),
          this.insightScopeWhere(),
        ),
      )
      .orderBy(desc(expertiseInsights.confidence))
      .limit(10);
  };

  dismissInsight = async (insightId: string, reason?: string) =>
    this.db
      .update(expertiseInsights)
      .set({ dismissReason: reason, status: 'dismissed', updatedAt: new Date() })
      .where(and(eq(expertiseInsights.id, insightId), this.insightScopeWhere()));
}
