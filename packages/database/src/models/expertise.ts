import type {
  ExpertiseAnchorCandidate,
  ExpertiseCanonEntry,
  ExpertiseEnforcement,
  ExpertiseLayerDefinition,
  ExpertiseLessonSection,
} from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

import {
  agents,
  documents,
  expertiseBindings,
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseInsights,
  expertiseLessonRevisions,
  expertiseLessons,
  expertiseRuns,
  projects,
  topics,
  verifyCheckResults,
  verifyRuns,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspaceWhere } from '../utils/workspace';

/** The core tier starts at 40% of the domain's maximum hit count, with a floor of two. */
const CORE_CUT_RATIO = 0.4;
const CORE_CUT_MIN = 2;

export type ExpertiseTier = 'core' | 'niche' | 'unused';

/**
 * Where a domain is mounted. Ownership (`expertise_domains.user_id` / `workspace_id`) is a
 * separate axis: a project never owns a domain, it only mounts one, so the same standard can be
 * mounted by several projects at once.
 */
export type ExpertiseCarrier =
  { id: string; type: 'agent' } | { id: string; type: 'project' } | { type: 'user' };

/** Whose a listed group is: the reviewer's own rules, or one agent's self-learning. */
export type ExpertiseGroupOwner =
  | { kind: 'mine' }
  | {
      agent: {
        avatar: string | null;
        backgroundColor: string | null;
        id: string;
        title: string | null;
      };
      kind: 'agent';
    };

/**
 * The single carrier column a binding sets. `user` resolves to the workspace when one is in
 * scope, so a workspace member's always-on standards reach their teammates rather than only
 * themselves — the same arm `listDomainsBoundTo` reads back.
 */
const carrierColumns = (
  carrier: ExpertiseCarrier,
  owner: { userId: string; workspaceId?: string },
) => {
  if (carrier.type === 'agent') return { agentId: carrier.id };
  if (carrier.type === 'project') return { projectId: carrier.id };
  return owner.workspaceId
    ? { boundWorkspaceId: owner.workspaceId }
    : { boundUserId: owner.userId };
};

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

  private listDomainsBoundTo = async (carrierWhere?: SQL) => {
    const ownerWhere = this.workspaceId
      ? eq(expertiseBindings.boundWorkspaceId, this.workspaceId)
      : eq(expertiseBindings.boundUserId, this.userId);

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
          carrierWhere ? or(carrierWhere, ownerWhere) : ownerWhere,
        ),
      )
      // Every binding starts at sortOrder 0, so without a tiebreak the order of a reviewer's
      // groups is whatever the planner returns and a newly opened group can jump to the top.
      .orderBy(asc(expertiseBindings.sortOrder), asc(expertiseDomains.createdAt));

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
   * Everything the self-evolving page lists — the reviewer's rules first, then what each agent
   * learned on its own — as groups with the lessons filed in them and where each takes effect.
   *
   * Reads the same binding arm the distillation writes through, so what this returns is exactly
   * what an acceptance without a project would add to. Rules come back in the reviewer's own
   * order (`sortOrder`, then creation) because they told us the order matters; the page does not
   * re-rank them by hit count.
   *
   * Each group carries an `owner`: `mine` when the reviewer, their workspace or a project holds
   * it (it reaches every run in that scope), otherwise the one agent it was learned by. A group
   * mounted on both is the reviewer's — that is the wider of the two reaches.
   */
  listRules = async () => {
    // The reviewer's own groups, the ones distilled from a project's acceptances, and every
    // agent's self-learning domains — the same set the run context injects from.
    const bound = await this.listDomainsBoundTo(
      or(isNotNull(expertiseBindings.projectId), isNotNull(expertiseBindings.agentId)),
    );
    const domainIds = bound.map(({ domain }) => domain.id);
    if (domainIds.length === 0) return [];

    const [lessons, bindings] = await Promise.all([
      this.db
        .select({
          code: expertiseLessons.code,
          compilability: expertiseLessons.compilability,
          createdAt: expertiseLessons.createdAt,
          createdByUserId: expertiseLessons.createdByUserId,
          domainId: expertiseLessons.domainId,
          originRunId: expertiseLessons.originRunId,
          // Rows that predate the column hold null; they have only ever been reminders.
          enforcement: sql<ExpertiseEnforcement>`coalesce(${expertiseLessons.enforcement}, 'remind')`,
          exampleCount: expertiseLessons.exampleCount,
          falsePositiveCount: expertiseLessons.falsePositiveCount,
          generalizedFromIds: expertiseLessons.generalizedFromIds,
          hitCount: expertiseLessons.hitCount,
          hitRunCount: expertiseLessons.hitRunCount,
          id: expertiseLessons.id,
          lastHitAt: expertiseLessons.lastHitAt,
          reasonKind: expertiseLessons.reasonKind,
          reasonSource: expertiseLessons.reasonSource,
          rejectedReason: expertiseLessons.rejectedReason,
          retiredAt: expertiseLessons.retiredAt,
          sections: expertiseLessons.sections,
          sortOrder: expertiseLessons.sortOrder,
          specificity: expertiseLessons.specificity,
          status: expertiseLessons.status,
          tags: expertiseLessons.tags,
          title: expertiseLessons.title,
        })
        .from(expertiseLessons)
        .where(
          and(
            inArray(expertiseLessons.domainId, domainIds),
            // Retired ones are kept and returned: the page files them under an archive the reader
            // can reopen, because "I already told it to stop using this" is itself worth seeing.
            inArray(expertiseLessons.status, ['active', 'retired']),
          ),
        )
        // Unplaced rows (null, from before the column existed) come after the ones the
        // reviewer ordered, oldest first, until a drag writes them an explicit position.
        .orderBy(
          sql`${expertiseLessons.sortOrder} asc nulls last`,
          asc(expertiseLessons.createdAt),
        ),
      this.db
        .select({
          agentAvatar: agents.avatar,
          agentBackgroundColor: agents.backgroundColor,
          agentId: expertiseBindings.agentId,
          agentTitle: agents.title,
          // Null when the agent exists but the viewer may not see it.
          visibleAgentId: agents.id,
          boundUserId: expertiseBindings.boundUserId,
          boundWorkspaceId: expertiseBindings.boundWorkspaceId,
          domainId: expertiseBindings.domainId,
          projectId: expertiseBindings.projectId,
          projectName: projects.name,
        })
        .from(expertiseBindings)
        .leftJoin(projects, eq(projects.id, expertiseBindings.projectId))
        // A shared group can also be mounted on a teammate's private agent; the viewer may see
        // the group without being allowed to see that agent, its id or its name.
        .leftJoin(
          agents,
          and(
            eq(agents.id, expertiseBindings.agentId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
          ),
        )
        .where(
          and(
            inArray(expertiseBindings.domainId, domainIds),
            eq(expertiseBindings.enabled, true),
            or(isNull(expertiseBindings.agentId), isNotNull(agents.id)),
          ),
        )
        .orderBy(asc(expertiseBindings.sortOrder)),
    ]);

    const bySource = await this.countHitsBySource(lessons.map((lesson) => lesson.id));

    // Bucket once by domain: the page now spans every agent's domains, so filtering the full
    // lesson and binding lists per group would grow with groups × rows.
    const byDomain = <T extends { domainId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const bucket = map.get(row.domainId);
        if (bucket) bucket.push(row);
        else map.set(row.domainId, [row]);
      }
      return map;
    };
    const lessonsByDomain = byDomain(lessons);
    const bindingsByDomain = byDomain(bindings);

    const ownerOf = (domainId: string): ExpertiseGroupOwner | null => {
      const mounts = bindingsByDomain.get(domainId) ?? [];
      if (mounts.some((binding) => !binding.agentId)) return { kind: 'mine' };
      const agent = mounts.find((binding) => binding.visibleAgentId);
      // Only mounted on agents the viewer cannot see: nothing of it belongs on their page.
      if (!agent?.agentId) return null;
      return {
        agent: {
          avatar: agent.agentAvatar,
          backgroundColor: agent.agentBackgroundColor,
          id: agent.agentId,
          title: agent.agentTitle,
        },
        kind: 'agent',
      };
    };

    const owned = bound.flatMap(({ domain }) => {
      const owner = ownerOf(domain.id);
      return owner ? [{ domain, owner }] : [];
    });
    // The reviewer's groups lead in their own order; each agent's follow together, agents in the
    // order their first group was mounted.
    const agentOrder = [
      ...new Set(owned.flatMap(({ owner }) => (owner.kind === 'agent' ? [owner.agent.id] : []))),
    ];
    const rank = ({ owner }: (typeof owned)[number]) =>
      owner.kind === 'mine' ? -1 : agentOrder.indexOf(owner.agent.id);
    const ordered = owned
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
      .map(({ entry }) => entry);

    return ordered.map(({ domain, owner }) => ({
      owner,
      domain: {
        domainFilter: domain.domainFilter,
        id: domain.id,
        outOfScope: domain.outOfScope,
        title: domain.title,
      },
      rules: (lessonsByDomain.get(domain.id) ?? [])
        // Written by the reviewer rather than distilled from a run. Hit counts grow as a rule is
        // applied, so provenance is read from where the row came from — same test the lesson
        // reader uses for `taughtByUser`.
        .map(({ originRunId, ...lesson }) => ({
          ...lesson,
          ...(bySource.get(lesson.id) ?? {
            conversationHitCount: 0,
            materialHitCount: 0,
            rejectionHitCount: 0,
          }),
          authored: lesson.createdByUserId != null && originRunId == null,
        })),
      scopes: (bindingsByDomain.get(domain.id) ?? []).map((binding) => {
        if (binding.projectId) {
          return { id: binding.projectId, kind: 'project' as const, title: binding.projectName };
        }
        if (binding.agentId) {
          return { id: binding.agentId, kind: 'agent' as const, title: binding.agentTitle };
        }
        return binding.boundWorkspaceId
          ? { id: binding.boundWorkspaceId, kind: 'workspace' as const, title: null }
          : { id: binding.boundUserId!, kind: 'user' as const, title: null };
      }),
    }));
  };

  /**
   * The rejections one rule was distilled from, resolved back to the acceptance they were
   * written in so the reader can reopen the round and see the frame they circled.
   *
   * Evidence never changes hands: a hit stays on the lesson and the run that produced it, because
   * both are pinned to their domain by composite keys. So a rule that absorbed others
   * (`generalizedFromIds`) or was re-filed into another group (`salvagedFromId`) reads its sources
   * through that lineage instead of owning them.
   *
   * `sourceCheckResultId` is nullable by design — a deleted acceptance leaves the rule standing
   * and only breaks the trail — so the joins are left joins and the caller renders an unlinked
   * row rather than dropping the evidence.
   */
  listLessonSources = async (lessonId: string, limit = 20) => {
    const lineage = await this.resolveLineage(lessonId);
    if (lineage.length === 0) return [];
    return (
      this.db
        .select({
          acceptanceId: verifyRuns.acceptanceId,
          checkTitle: verifyCheckResults.checkItemTitle,
          createdAt: expertiseHits.createdAt,
          example: expertiseHits.example,
          // A material the reviewer brought: the document it was read from (a file is recorded as
          // its parsed document, which keeps the file id), and which kind of material it was.
          documentFileId: documents.fileId,
          documentId: documents.id,
          // Read from the run, not from the check-result join: a deleted acceptance leaves that
          // join empty, and the hit was still a rejection.
          fromAcceptance: sql<boolean>`coalesce(${expertiseRuns.reflectionKey}, '') like 'acceptance:%'`,
          materialType: sql<
            string | null
          >`case when ${expertiseRuns.reflectionKey} like 'material:%' then split_part(${expertiseRuns.reflectionKey}, ':', 2) end`,
          id: expertiseHits.id,
          // Where a conversation source can be reopened: the topic, the agent it lives under, and
          // the message the observation was read from when ingestion could find it.
          messageId: expertiseHits.sourceMessageId,
          reviewerComment: sql<
            string | null
          >`${verifyCheckResults.userDecisionDetail} ->> 'comment'`,
          roundIndex: verifyRuns.roundIndex,
          severity: expertiseHits.severity,
          topicAgentId: topics.agentId,
          topicId: topics.id,
          userDecision: expertiseHits.userDecision,
          where: expertiseHits.where,
        })
        .from(expertiseHits)
        .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseHits.domainId))
        .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
        // Only a topic the viewer can open: a shared group does not grant a teammate's topic.
        .leftJoin(
          topics,
          and(
            eq(expertiseRuns.subjectType, 'topic'),
            eq(topics.id, expertiseRuns.subjectId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
          ),
        )
        // Only a document the viewer can open, by the same scope documents are listed with.
        .leftJoin(
          documents,
          and(
            eq(expertiseRuns.subjectType, 'document'),
            eq(documents.id, expertiseRuns.subjectId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
          ),
        )
        .leftJoin(verifyCheckResults, eq(verifyCheckResults.id, expertiseHits.sourceCheckResultId))
        .leftJoin(verifyRuns, eq(verifyRuns.id, verifyCheckResults.verifyRunId))
        .where(
          and(
            inArray(expertiseHits.lessonId, lineage),
            this.scopeWhere(),
            // Access to a shared group is not access to the rounds behind it: a hit distilled from
            // a teammate's private round would otherwise show that round's check, the reviewer's
            // words and a link to it. Same predicate the consolidation reader applies.
            or(
              eq(verifyCheckResults.userId, this.userId),
              eq(verifyRuns.visibility, 'public'),
              // No linked round (never mapped, or the round was deleted): nothing says the viewer
              // may see where it came from, so only their own runs' evidence is shown.
              and(isNull(verifyCheckResults.id), eq(expertiseRuns.userId, this.userId)),
            ),
          ),
        )
        .orderBy(desc(expertiseHits.createdAt))
        .limit(limit)
    );
  };

  /**
   * Every lesson whose evidence this one now speaks for: itself, what it absorbed through merges
   * (`generalizedFromIds`) and what it was re-filed from (`salvagedFromId`), followed through as
   * many generations as there are. One level is not enough — merging a rule that was itself a
   * merge would otherwise keep the counts and lose the evidence.
   */
  private resolveLineage = async (lessonId: string): Promise<string[]> =>
    (await this.resolveLineages([lessonId])).get(lessonId) ?? [];

  /**
   * {@link resolveLineage} for many rules at once: one read per generation instead of one walk
   * per rule, so a whole page of rules costs a handful of queries. A rule outside the caller's
   * scope maps to an empty lineage.
   */
  private resolveLineages = async (lessonIds: string[]) => {
    const parents = new Map<string, string[]>();
    let frontier = [...new Set(lessonIds)];
    // Bounded so a malformed cycle can never spin; real lineages are a handful of steps deep.
    for (let depth = 0; depth <= 16 && frontier.length > 0; depth += 1) {
      const rows = await this.db
        .select({
          generalizedFromIds: expertiseLessons.generalizedFromIds,
          id: expertiseLessons.id,
          salvagedFromId: expertiseLessons.salvagedFromId,
        })
        .from(expertiseLessons)
        .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
        .where(and(inArray(expertiseLessons.id, frontier), this.scopeWhere()));
      for (const row of rows) {
        parents.set(row.id, [
          ...(row.generalizedFromIds ?? []),
          ...(row.salvagedFromId ? [row.salvagedFromId] : []),
        ]);
      }
      frontier = [...new Set(rows.flatMap((row) => parents.get(row.id) ?? []))].filter(
        (id) => !parents.has(id),
      );
    }

    return new Map(
      lessonIds.map((root) => {
        if (!parents.has(root)) return [root, []];
        const seen = new Set<string>([root]);
        const stack = [root];
        while (stack.length > 0) {
          for (const parent of parents.get(stack.pop()!) ?? []) {
            if (seen.has(parent)) continue;
            seen.add(parent);
            stack.push(parent);
          }
        }
        return [root, [...seen]];
      }),
    );
  };

  /**
   * How many times each rule's lineage was hit by a rejected acceptance versus observed in a
   * conversation. `hitCount` adds both, and the two mean different things to the reviewer: only
   * the first is "you rejected a delivery for this".
   */
  private countHitsBySource = async (lessonIds: string[]) => {
    const lineages = await this.resolveLineages(lessonIds);
    const all = [...new Set([...lineages.values()].flat())];
    const rows =
      all.length === 0
        ? []
        : await this.db
            .select({
              conversations: sql<number>`count(*) filter (where coalesce(${expertiseRuns.reflectionKey}, '') not like 'acceptance:%' and coalesce(${expertiseRuns.reflectionKey}, '') not like 'material:%')::int`,
              lessonId: expertiseHits.lessonId,
              // Read from a material the reviewer brought: evidence the rule was stated, not seen.
              materials: sql<number>`count(*) filter (where ${expertiseRuns.reflectionKey} like 'material:%')::int`,
              rejections: sql<number>`count(*) filter (where ${expertiseRuns.reflectionKey} like 'acceptance:%')::int`,
            })
            .from(expertiseHits)
            .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
            .where(inArray(expertiseHits.lessonId, all))
            .groupBy(expertiseHits.lessonId);
    const byLesson = new Map(rows.map((row) => [row.lessonId, row]));

    return new Map(
      lessonIds.map((id) => {
        const lineage = lineages.get(id) ?? [];
        const sum = (key: 'conversations' | 'materials' | 'rejections') =>
          lineage.reduce((total, member) => total + (byLesson.get(member)?.[key] ?? 0), 0);
        return [
          id,
          {
            conversationHitCount: sum('conversations'),
            materialHitCount: sum('materials'),
            rejectionHitCount: sum('rejections'),
          },
        ];
      }),
    );
  };

  /**
   * Rejected rounds no standard has been distilled from yet.
   *
   * Distillation only fires forward — a round is read when the NEXT one lands — so every round
   * rejected before the feature existed stays untouched unless something asks for it. This is
   * that backlog, and it is the only honest number to put on an empty standards page.
   */
  countUndistilledRejectionRounds = async () => {
    const [row] = await this.db
      .select({
        rounds: sql<number>`count(distinct ${verifyCheckResults.verifyRunId})::int`,
      })
      .from(verifyCheckResults)
      .where(
        and(
          eq(verifyCheckResults.userId, this.userId),
          // The page is either the personal view or one workspace's; count only that scope.
          this.workspaceId
            ? eq(verifyCheckResults.workspaceId, this.workspaceId)
            : isNull(verifyCheckResults.workspaceId),
          eq(verifyCheckResults.userDecision, 'rejected'),
          isNotNull(verifyCheckResults.verifyRunId),
          sql`not exists (
            select 1 from ${expertiseRuns}
            where ${expertiseRuns.reflectionKey} like '%:run:' || ${verifyCheckResults.verifyRunId}::text
          )`,
        ),
      );

    return row?.rounds ?? 0;
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

  /**
   * Who a domain reaches, as one comparable key — the same rule `listRules` uses for its
   * `owner`: `mine` when any enabled binding is not an agent's (the reviewer, workspace or a
   * project), otherwise the agents it is mounted on. A rule moved or merged across reaches would
   * silently change which runs receive it, so both mutations refuse that.
   */
  private reachOf = async (domainId: string) => {
    const mounts = await this.db
      .select({ agentId: expertiseBindings.agentId })
      .from(expertiseBindings)
      .where(and(eq(expertiseBindings.domainId, domainId), eq(expertiseBindings.enabled, true)));
    if (mounts.some((mount) => !mount.agentId)) return 'mine';
    const agentIds = [...new Set(mounts.map((mount) => mount.agentId!))].sort();
    return agentIds.length > 0 ? `agent:${agentIds.join(',')}` : 'unbound';
  };

  /** Whether two domains reach the same runs; see {@link reachOf}. */
  sameReach = async (domainA: string, domainB: string) => {
    if (domainA === domainB) return true;
    const [a, b] = await Promise.all([this.reachOf(domainA), this.reachOf(domainB)]);
    return a === b;
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
   * Persists a reviewed anchor and mounts it on the selected carrier.
   * The chosen candidate is also kept in anchorCandidates so the alternative can be revisited.
   */
  createDomain = async (params: {
    brief: string;
    canonEntries?: ExpertiseCanonEntry[];
    carrier: ExpertiseCarrier;
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
      const carrier = carrierColumns(params.carrier, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      // A new mount goes after the ones already there. Leaving every binding at 0 makes the
      // reviewer's group order depend on the query plan.
      const [carrierColumn, carrierValue] = Object.entries(carrier)[0] as [
        keyof typeof expertiseBindings.$inferInsert,
        string,
      ];
      const [last] = await tx
        .select({ sortOrder: sql<number>`max(${expertiseBindings.sortOrder})` })
        .from(expertiseBindings)
        .where(eq(expertiseBindings[carrierColumn as 'boundUserId'], carrierValue));
      await tx.insert(expertiseBindings).values({
        addedByUserId: this.userId,
        domainId: id,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        workspaceId: this.workspaceId,
        ...carrier,
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

  /**
   * The edits a standard has been through, newest first.
   *
   * `feedback` is the reviewer's own sentence and `changedBy` says whether the edit came from them
   * or from the system generalizing, which is the distinction that makes the history readable.
   */
  listLessonRevisions = async (lessonId: string, limit = 10) => {
    // A rule re-filed into another group is a copy; its earlier edits stay on the row it was
    // copied from. Follow `salvagedFromId` back so the history reads as one rule's. Merged-in
    // rules are not followed: their edits were to a different sentence.
    const chain = [lessonId];
    for (let depth = 0; depth < 16; depth += 1) {
      const [row] = await this.db
        .select({ salvagedFromId: expertiseLessons.salvagedFromId })
        .from(expertiseLessons)
        .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
        .where(and(eq(expertiseLessons.id, chain.at(-1)!), this.scopeWhere()))
        .limit(1);
      const previous = row?.salvagedFromId;
      if (!previous || chain.includes(previous)) break;
      chain.push(previous);
    }
    const rows = await this.db
      .select({
        changedBy: expertiseLessonRevisions.changedBy,
        changedByUserId: expertiseLessonRevisions.changedByUserId,
        createdAt: expertiseLessonRevisions.createdAt,
        feedback: expertiseLessonRevisions.feedback,
        id: expertiseLessonRevisions.id,
        kind: expertiseLessonRevisions.kind,
        prevTitle: expertiseLessonRevisions.prevTitle,
        revision: expertiseLessonRevisions.revision,
      })
      .from(expertiseLessonRevisions)
      .innerJoin(expertiseLessons, eq(expertiseLessons.id, expertiseLessonRevisions.lessonId))
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
      .where(and(inArray(expertiseLessonRevisions.lessonId, chain), this.scopeWhere()))
      .orderBy(desc(expertiseLessonRevisions.revision), desc(expertiseLessonRevisions.createdAt))
      .limit(limit);
    // In a shared group any member can edit; the reader is told whether an edit was theirs, and
    // the other member's id does not leave the server.
    return rows.map(({ changedByUserId, ...row }) => ({
      ...row,
      byViewer: changedByUserId === this.userId,
    }));
  };

  /** Brings a retired standard back into practice. */
  restoreLesson = async (lessonId: string) => {
    const lesson = await this.findLesson(lessonId);
    if (!lesson) return null;
    // A rule archived by a merge already lives on inside its target: its counts were added there
    // and its evidence is read through the target's lineage. Bringing it back would count the
    // same history twice, so it stays archived.
    if (lesson.rejectedReason?.startsWith('merged-into:')) return null;
    await this.db
      .update(expertiseLessons)
      .set({ retiredAt: null, status: 'active', updatedAt: new Date() })
      .where(eq(expertiseLessons.id, lessonId));
    return { id: lessonId };
  };

  /**
   * The next free `P-nn` code inside one domain; codes are unique per domain, not globally.
   *
   * Takes the domain row lock first — the same lock distillation holds while it hands out codes —
   * so two writers in one group queue up instead of computing the same number and having the
   * unique index reject one of them. The lock lasts until the caller's transaction commits.
   */
  private nextLessonCode = async (
    tx: Pick<LobeChatDatabase, 'select'>,
    domainId: string,
  ): Promise<string> => {
    await tx
      .select({ id: expertiseDomains.id })
      .from(expertiseDomains)
      .where(eq(expertiseDomains.id, domainId))
      .for('update');
    const codes = await tx
      .select({ code: expertiseLessons.code })
      .from(expertiseLessons)
      .where(eq(expertiseLessons.domainId, domainId));
    const next =
      Math.max(0, ...codes.map(({ code }) => Number(/^P-(\d+)$/.exec(code)?.[1] ?? 0))) + 1;
    return `P-${String(next).padStart(2, '0')}`;
  };

  /**
   * A rule the reviewer writes down themselves, filed at the top of its group so they see it
   * where they just put it. Hand-written rules start as `taste` from the reviewer: nothing has
   * been distilled, so there is no mechanism to claim yet.
   */
  createRule = async (params: {
    compilability?: 'compilable' | 'not-compilable';
    domainId: string;
    enforcement?: ExpertiseEnforcement;
    how?: string;
    limits?: string;
    /**
     * The run it was read from, when it was distilled from a material rather than typed. It also
     * keeps the row from reading as "you wrote it", which is decided by the absence of an origin.
     */
    originRunId?: string;
    title: string;
    why?: string;
  }) => {
    const domain = await this.findDomain(params.domainId);
    if (!domain) return null;
    const title = params.title.trim();
    const sections: ExpertiseLessonSection[] = [{ body: title, key: 'rule' }];
    for (const key of ['why', 'how', 'limits'] as const) {
      const body = params[key]?.trim();
      if (body) sections.push({ body, key });
    }

    return this.db.transaction(async (tx) => {
      const code = await this.nextLessonCode(tx, params.domainId);
      const [first] = await tx
        .select({ sortOrder: sql<number>`min(${expertiseLessons.sortOrder})` })
        .from(expertiseLessons)
        .where(eq(expertiseLessons.domainId, params.domainId));
      const [row] = await tx
        .insert(expertiseLessons)
        .values({
          code,
          compilability: params.compilability ?? 'not-compilable',
          createdByUserId: this.userId,
          domainId: params.domainId,
          enforcement: params.enforcement ?? 'remind',
          originRunId: params.originRunId,
          polarity: 'rule',
          reasonKind: 'taste',
          reasonSource: 'reviewer',
          sections,
          sortOrder: (first?.sortOrder ?? 1) - 1,
          title,
        })
        .returning({ code: expertiseLessons.code, id: expertiseLessons.id });
      return row;
    });
  };

  /**
   * One reading of a material the reviewer brought, as a run on one domain. `reflectionKey`
   * starts with `material:` so counts and sources can tell it apart from rejections and
   * conversations the system observed on its own.
   */
  insertMaterialRun = async (params: {
    domainId: string;
    reflectionKey: string;
    subjectId: string;
    subjectType: 'document' | 'standalone' | 'topic';
  }) => {
    const [prior] = await this.db
      .select({ value: sql<number | null>`max(${expertiseRuns.runIndex})` })
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, params.domainId));
    const [row] = await this.db
      .insert(expertiseRuns)
      .values({
        actorId: this.userId,
        actorType: 'user',
        completedAt: new Date(),
        domainId: params.domainId,
        hadHumanInLoop: true,
        reflectionKey: params.reflectionKey,
        runIndex: (prior?.value ?? 0) + 1,
        subjectId: params.subjectId,
        subjectType: params.subjectType,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning({ id: expertiseRuns.id });
    return row.id;
  };

  /**
   * The passage of a material a rule was read from. It is evidence that the material states the
   * rule, not a violation, so it does not add to `hitCount`.
   */
  insertMaterialHit = async (params: {
    domainId: string;
    lessonId: string;
    quote: string;
    runId: string;
    where: string;
  }) => {
    const [row] = await this.db
      .insert(expertiseHits)
      .values({
        domainId: params.domainId,
        example: params.quote || null,
        lessonId: params.lessonId,
        outcome: 'pass',
        runId: params.runId,
        where: params.where,
      })
      .returning({ id: expertiseHits.id });
    return row.id;
  };

  /**
   * The same row `findLesson` returns, read under a row lock for the rest of the caller's
   * transaction. Anything computed from it — the next revision number, a section patch, merged
   * counts — stays valid until commit, so a concurrent edit waits instead of being overwritten.
   */
  lockLesson = async (lessonId: string) => {
    const [row] = await this.db
      .select({ lesson: expertiseLessons })
      .from(expertiseLessons)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
      .where(and(eq(expertiseLessons.id, lessonId), this.scopeWhere()))
      .for('update', { of: expertiseLessons })
      .limit(1);
    return row?.lesson;
  };

  /** Appends one entry to a lesson's edit history. */
  insertLessonRevision = async (values: typeof expertiseLessonRevisions.$inferInsert) => {
    await this.db.insert(expertiseLessonRevisions).values(values);
  };

  /** Writes fields of one lesson row; `updatedAt` is always refreshed. */
  updateLessonFields = async (
    lessonId: string,
    fields: Partial<typeof expertiseLessons.$inferInsert>,
  ) => {
    await this.db
      .update(expertiseLessons)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(expertiseLessons.id, lessonId));
  };

  /**
   * Distinct runs a lesson has been proven in across its whole lineage. Runs are "distinct
   * situations", so two merged rules hit in the same delivery count it once.
   */
  countLineageRuns = async (lessonId: string) => {
    const lineage = await this.resolveLineage(lessonId);
    if (lineage.length === 0) return 0;
    const [row] = await this.db
      .select({ runs: sql<number>`count(distinct ${expertiseHits.runId})::int` })
      .from(expertiseHits)
      .where(inArray(expertiseHits.lessonId, lineage));
    return row?.runs ?? 0;
  };

  /**
   * Applies one drag inside a group. Only that group's active rules are renumbered; a rule from
   * elsewhere is refused rather than pulled across, because moving between groups changes the
   * code and goes through `moveRule`.
   */
  reorderRule = async (domainId: string, lessonId: string, beforeId: string | null) => {
    const domain = await this.findDomain(domainId);
    if (!domain) return null;
    return this.db.transaction(async (tx) => {
      // The server's own order, not a list sent by the client: a stale or partial client view
      // cannot scramble the group, and the request stays one id no matter how large it grows.
      const rows = await tx
        .select({ id: expertiseLessons.id, sortOrder: expertiseLessons.sortOrder })
        .from(expertiseLessons)
        .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')))
        .orderBy(
          sql`${expertiseLessons.sortOrder} asc nulls last`,
          asc(expertiseLessons.createdAt),
        );
      if (!rows.some((row) => row.id === lessonId)) return null;

      const order = rows.map((row) => row.id).filter((id) => id !== lessonId);
      const at = beforeId ? order.indexOf(beforeId) : -1;
      order.splice(at === -1 ? order.length : at, 0, lessonId);

      const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
      for (const [index, id] of order.entries()) {
        if (current.get(id) === index) continue;
        await tx
          .update(expertiseLessons)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(eq(expertiseLessons.id, id));
      }
      return { domainId, order };
    });
  };

  /**
   * Files a rule under another of the reviewer's groups, at the end, with a fresh code there.
   *
   * A rule with no evidence simply changes domain. One with evidence cannot: its hits are pinned
   * to the run and domain that produced them, so the rule is re-created in the target group with
   * `salvagedFromId` pointing at the original, and the original is hidden (`rejected`, not
   * archived — it did not stop applying, it moved). The caller gets the id that is now live.
   */
  moveRule = async (lessonId: string, domainId: string) => {
    const [lesson, domain] = await Promise.all([
      this.findLesson(lessonId),
      this.findDomain(domainId),
    ]);
    if (!lesson || !domain) return null;
    if (lesson.domainId === domainId) return { domainId, id: lessonId };
    // Older clients list every group in the move menu; the boundary has to hold here too.
    if (!(await this.sameReach(lesson.domainId, domainId))) return null;

    return this.db.transaction(async (tx) => {
      // Re-read under a row lock and copy from that: a merge committed since the read above has
      // already folded this rule into another one, and copying it now would leave the same
      // evidence live twice.
      const [current] = await tx
        .select()
        .from(expertiseLessons)
        .where(eq(expertiseLessons.id, lessonId))
        .for('update');
      if (current?.status !== 'active' || current.domainId !== lesson.domainId) return null;

      const code = await this.nextLessonCode(tx, domainId);
      const [last] = await tx
        .select({ sortOrder: sql<number>`max(${expertiseLessons.sortOrder})` })
        .from(expertiseLessons)
        .where(eq(expertiseLessons.domainId, domainId));
      const sortOrder = (last?.sortOrder ?? -1) + 1;
      const [{ hits }] = await tx
        .select({ hits: sql<number>`count(*)::int` })
        .from(expertiseHits)
        .where(eq(expertiseHits.lessonId, lessonId));

      if (hits === 0) {
        await tx
          .update(expertiseLessons)
          .set({ code, domainId, sortOrder, updatedAt: new Date() })
          .where(eq(expertiseLessons.id, lessonId));
        return { domainId, id: lessonId };
      }

      const {
        createdAt: _createdAt,
        id: _id,
        updatedAt: _updatedAt,
        accessedAt: _accessedAt,
        ...carried
      } = current;
      const [copy] = await tx
        .insert(expertiseLessons)
        .values({ ...carried, code, domainId, salvagedFromId: lessonId, sortOrder })
        .returning({ id: expertiseLessons.id });
      await tx
        .update(expertiseLessons)
        .set({ rejectedReason: `moved-to:${copy.id}`, status: 'rejected', updatedAt: new Date() })
        .where(eq(expertiseLessons.id, lessonId));
      return { domainId, id: copy.id };
    });
  };

  /**
   * A group the reviewer opens by hand. It is a plain always-on domain: the gate question is the
   * domain filter, and it mounts on the reviewer themselves so every acceptance without a project
   * can add to it.
   *
   * A name the reviewer already uses returns that group instead of opening a second one. The
   * drafting model proposes a group name without seeing which ones already exist in every case,
   * and two groups with the same name on one page are indistinguishable to the reader.
   */
  createRuleGroup = async (params: { gate: string; outOfScope?: string; title: string }) => {
    const title = params.title.trim();
    const existing = await this.listDomainsForOwner();
    const match = existing.find(
      ({ domain }) => domain.title.trim().toLowerCase() === title.toLowerCase(),
    );
    if (match) return match.domain.id;

    return this.createDomain({
      brief: title,
      carrier: { type: 'user' },
      domainFilter: params.gate,
      outOfScope: params.outOfScope,
      title,
    });
  };

  /** Renames a group; the gate question can be changed the same way. */
  updateRuleGroup = async (
    domainId: string,
    patch: { gate?: string; outOfScope?: string | null; title?: string },
  ) => {
    const domain = await this.findDomain(domainId);
    if (!domain) return null;
    const title = patch.title?.trim();
    const gate = patch.gate?.trim();
    await this.db
      .update(expertiseDomains)
      .set({
        ...(title && { title }),
        ...(gate && { domainFilter: gate }),
        // Empty clears the exclusion; undefined leaves it alone.
        ...(patch.outOfScope !== undefined && { outOfScope: patch.outOfScope?.trim() || null }),
        updatedAt: new Date(),
      })
      .where(eq(expertiseDomains.id, domainId));
    return { id: domainId };
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
