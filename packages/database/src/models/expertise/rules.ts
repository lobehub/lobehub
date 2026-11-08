import { type ExpertiseEnforcement } from '@lobechat/types';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import {
  agents,
  expertiseBindings,
  expertiseLessons,
  expertiseRuns,
  projects,
  verifyCheckResults,
} from '../../schemas';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { type ExpertiseContext } from './context';
import { listDomainsBoundTo } from './domains';
import { countHitsBySource } from './lineage';

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
export const listRules = async (ctx: ExpertiseContext) => {
  // The reviewer's own groups, the ones distilled from a project's acceptances, and every
  // agent's self-learning domains — the same set the run context injects from.
  const bound = await listDomainsBoundTo(
    ctx,
    or(isNotNull(expertiseBindings.projectId), isNotNull(expertiseBindings.agentId)),
  );
  const domainIds = bound.map(({ domain }) => domain.id);
  if (domainIds.length === 0) return [];

  const [lessons, bindings] = await Promise.all([
    ctx.db
      .select({
        code: expertiseLessons.code,
        compilability: expertiseLessons.compilability,
        createdAt: expertiseLessons.createdAt,
        createdByUserId: expertiseLessons.createdByUserId,
        // Null until judged; the page asks for the unjudged ones to be settled.
        direction: expertiseLessons.direction,
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
      .orderBy(sql`${expertiseLessons.sortOrder} asc nulls last`, asc(expertiseLessons.createdAt)),
    ctx.db
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
          buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, agents),
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

  const bySource = await countHitsBySource(
    ctx,
    lessons.map((lesson) => lesson.id),
  );

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
        /* v8 ignore start -- unreachable: the fallback; countHitsBySource maps every lesson id it was given, and it was given all of them */
        ...(bySource.get(lesson.id) ?? {
          conversationHitCount: 0,
          materialHitCount: 0,
          rejectionHitCount: 0,
        }),
        /* v8 ignore stop */
        authored: lesson.createdByUserId != null && originRunId == null,
      })),
    scopes: (
      bindingsByDomain.get(domain.id) ??
      /* v8 ignore start -- unreachable: the `[]` arm; ownerOf keeps a group only when it has at least one visible binding */
      []
    )
      /* v8 ignore stop */
      .map((binding) => {
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
 * Rejected rounds no standard has been distilled from yet.
 *
 * Distillation only fires forward — a round is read when the NEXT one lands — so every round
 * rejected before the feature existed stays untouched unless something asks for it. This is
 * that backlog, and it is the only honest number to put on an empty standards page.
 */
export const countUndistilledRejectionRounds = async (ctx: ExpertiseContext) => {
  const [row] = await ctx.db
    .select({
      rounds: sql<number>`count(distinct ${verifyCheckResults.verifyRunId})::int`,
    })
    .from(verifyCheckResults)
    .where(
      and(
        eq(verifyCheckResults.userId, ctx.userId),
        // The page is either the personal view or one workspace's; count only that scope.
        ctx.workspaceId
          ? eq(verifyCheckResults.workspaceId, ctx.workspaceId)
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
