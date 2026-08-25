import type {
  ExpertiseAnchorCandidate,
  ExpertiseCanonEntry,
  ExpertiseLayerDefinition,
  ExpertiseLessonSection,
} from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseInsights,
  expertiseLessonRevisions,
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

  /**
   * Per-run pass/violation counts — the reliability series behind the "做对率" chart.
   * A run without hits produces no row; callers treat missing runs as "nothing to judge".
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
      .where(inArray(expertiseHits.domainId, domainIds))
      .groupBy(expertiseHits.domainId, expertiseRuns.runIndex)
      .orderBy(asc(expertiseHits.domainId), asc(expertiseRuns.runIndex));
  };

  /**
   * Active lessons for the portrait, each with its most recent hit outcomes (newest last).
   * Recent outcomes are what the client folds into a reliability tier; the topic title of each
   * hit lets the row say *where* it last went wrong without another query.
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
        .where(inArray(expertiseHits.domainId, domainIds)),
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

  /**
   * Persists a reviewed anchor and binds it to the selected agent.
   * The chosen candidate is also kept in anchorCandidates so the alternative can be revisited.
   */
  createDomain = async (params: {
    agentId: string;
    brief: string;
    canonEntries?: ExpertiseCanonEntry[];
    domainFilter: string;
    layerCanonRef?: string;
    layerSource?: 'canonical' | 'invented';
    layers?: ExpertiseLayerDefinition[];
    outOfScope?: string;
    rationale?: string;
    title: string;
  }) => {
    const brief = params.brief.trim();
    const id = idGenerator('expertiseDomains');
    const title = params.title.trim();
    const domainFilter = params.domainFilter.trim();
    const slug = `${title.slice(0, 40).replaceAll(/\s+/g, '-').toLowerCase()}-${id.slice(-6)}`;
    const layers = params.layers ?? [];
    const canonEntries = params.canonEntries ?? [];
    const layerSource = params.layerSource ?? 'invented';
    const candidate: ExpertiseAnchorCandidate = {
      canonEntries,
      domainFilter,
      key: 'chosen',
      layerCanonRef: params.layerCanonRef,
      layers,
      layerSource,
      outOfScope: params.outOfScope?.trim() || undefined,
      rationale: params.rationale?.trim() || undefined,
      title,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(expertiseDomains).values({
        anchorCandidates: [candidate],
        anchorChosenAt: new Date(),
        anchorChosenByUserId: this.userId,
        canonEntries,
        description: brief,
        domainFilter,
        id,
        layerSource,
        layers,
        outOfScope: params.outOfScope?.trim() || null,
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

  /**
   * Deletes a domain the user owns together with everything learned in it — bindings, lessons,
   * runs, hits, snapshots and insights all cascade from the domain row. Nothing is kept: the
   * user chose to drop the direction, not to pause it.
   */
  deleteDomain = async (domainId: string) => {
    const [row] = await this.db
      .delete(expertiseDomains)
      .where(and(eq(expertiseDomains.id, domainId), this.scopeWhere()))
      .returning({ id: expertiseDomains.id });
    return row ?? null;
  };

  /** Stores a lesson the user taught directly; it takes effect on the next matching practice. */
  teachLesson = async (params: { domainId: string; text: string }) => {
    const domain = await this.findDomain(params.domainId);
    if (!domain) return null;
    const text = params.text.trim();
    const title = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    return this.db.transaction(async (tx) => {
      const codes = await tx
        .select({ code: expertiseLessons.code })
        .from(expertiseLessons)
        .where(eq(expertiseLessons.domainId, params.domainId));
      const next =
        Math.max(0, ...codes.map(({ code }) => Number(/^P-(\d+)$/.exec(code)?.[1] ?? 0))) + 1;
      const code = `P-${String(next).padStart(2, '0')}`;
      const [row] = await tx
        .insert(expertiseLessons)
        .values({
          code,
          createdByUserId: this.userId,
          domainId: params.domainId,
          polarity: 'rule',
          sections: [{ body: text, key: 'rule' }],
          title,
        })
        .returning({ code: expertiseLessons.code, id: expertiseLessons.id });
      return row;
    });
  };

  /**
   * Records the user's correction as a new revision and folds it into the lesson body.
   * The correction is kept as its own section so the original judgment stays legible.
   */
  reviseLesson = async (lessonId: string, feedback: string) => {
    const lesson = await this.findLesson(lessonId);
    if (!lesson) return null;
    const text = feedback.trim();
    const sections: ExpertiseLessonSection[] = [
      ...lesson.sections.filter((s) => s.key !== 'limits'),
      { body: text, key: 'limits' },
    ];
    const revision = lesson.currentRevision + 1;
    await this.db.transaction(async (tx) => {
      await tx.insert(expertiseLessonRevisions).values({
        changedBy: 'user',
        changedByUserId: this.userId,
        feedback: text,
        kind: 'user-feedback',
        lessonId,
        prevTitle: lesson.title,
        revision,
        sections,
      });
      await tx
        .update(expertiseLessons)
        .set({ currentRevision: revision, sections, updatedAt: new Date() })
        .where(eq(expertiseLessons.id, lessonId));
    });
    return { id: lessonId, revision };
  };

  /** Retires a lesson so it stops being practiced; the record and its evidence are kept. */
  retireLesson = async (lessonId: string) => {
    const lesson = await this.findLesson(lessonId);
    if (!lesson) return null;
    await this.db
      .update(expertiseLessons)
      .set({ retiredAt: new Date(), status: 'retired', updatedAt: new Date() })
      .where(eq(expertiseLessons.id, lessonId));
    return { id: lessonId };
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
