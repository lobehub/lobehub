import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

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
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspaceWhere } from '../utils/workspace';

/** The core tier starts at 40% of the domain's maximum hit count, with a floor of two. */
const CORE_CUT_RATIO = 0.4;
const CORE_CUT_MIN = 2;

export type ExpertiseTier = 'core' | 'niche' | 'unused';

export class ExpertiseModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private scopeWhere = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, expertiseDomains);

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

    const rows = await this.db
      .select({
        binding: {
          contributionMode: expertiseBindings.contributionMode,
          enabled: expertiseBindings.enabled,
          id: expertiseBindings.id,
          sortOrder: expertiseBindings.sortOrder,
        },
        domain: expertiseDomains,
      })
      .from(expertiseBindings)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
      .where(
        and(
          eq(expertiseBindings.enabled, true),
          isNotNull(expertiseDomains.anchorChosenAt),
          this.scopeWhere(),
          or(
            eq(expertiseBindings.agentId, agentId),
            this.workspaceId
              ? eq(expertiseBindings.boundWorkspaceId, this.workspaceId)
              : eq(expertiseBindings.boundUserId, this.userId),
          ),
        ),
      )
      .orderBy(asc(expertiseBindings.sortOrder));

    // One domain may be bound at multiple levels; retain the first binding by sort order.
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.domain.id)) return false;
      seen.add(r.domain.id);
      return true;
    });
  };

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

  /** Lists the agents that have practiced each domain. */
  actorsByDomain = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .selectDistinct({ actorId: expertiseRuns.actorId, domainId: expertiseRuns.domainId })
      .from(expertiseRuns)
      .where(and(inArray(expertiseRuns.domainId, domainIds), eq(expertiseRuns.actorType, 'agent')));
  };

  // L1: domain detail

  findDomain = async (domainId: string) => {
    const [row] = await this.db
      .select()
      .from(expertiseDomains)
      .where(
        and(
          eq(expertiseDomains.id, domainId),
          isNotNull(expertiseDomains.anchorChosenAt),
          this.scopeWhere(),
        ),
      )
      .limit(1);
    return row;
  };

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

  findLesson = async (lessonId: string) => {
    const [row] = await this.db
      .select({ lesson: expertiseLessons })
      .from(expertiseLessons)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
      .where(and(eq(expertiseLessons.id, lessonId), this.scopeWhere()))
      .limit(1);
    return row?.lesson;
  };

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

  /** Persists a model-generated domain definition and binds it to the selected agent. */
  createDomain = async (params: {
    agentId: string;
    brief: string;
    domainFilter: string;
    outOfScope?: string;
    title: string;
  }) => {
    const brief = params.brief.trim();
    const id = idGenerator('expertiseDomains');
    const title = params.title.trim();
    const domainFilter = params.domainFilter.trim();
    const slug = `${title.slice(0, 40).replaceAll(/\s+/g, '-').toLowerCase()}-${id.slice(-6)}`;

    await this.db.transaction(async (tx) => {
      await tx.insert(expertiseDomains).values({
        anchorChosenAt: new Date(),
        anchorChosenByUserId: this.userId,
        description: brief,
        domainFilter,
        outOfScope: params.outOfScope?.trim() || null,
        id,
        seedState: 'seeded',
        slug,
        title,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      await tx.insert(expertiseBindings).values({
        addedByUserId: this.userId,
        agentId: params.agentId,
        domainId: id,
        workspaceId: this.workspaceId,
      });
    });
    return id;
  };

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
