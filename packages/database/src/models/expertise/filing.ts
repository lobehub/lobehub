import {
  type ExpertiseEnforcement,
  type ExpertiseLessonSection,
  type ExpertiseRuleDirection,
} from '@lobechat/types';
import { and, asc, eq, sql } from 'drizzle-orm';

import { expertiseDomains, expertiseHits, expertiseLessons, expertiseRuns } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { domainScopeWhere, type ExpertiseContext } from './context';

/**
 * The next free `P-nn` code inside one domain; codes are unique per domain, not globally.
 *
 * Takes the domain row lock first — the same lock distillation holds while it hands out codes —
 * so two writers in one group queue up instead of computing the same number and having the
 * unique index reject one of them. The lock lasts until the caller's transaction commits.
 */
const nextLessonCode = async (
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
export const createRule = async (
  ctx: ExpertiseContext,
  params: {
    compilability?: 'compilable' | 'not-compilable';
    direction?: ExpertiseRuleDirection;
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
  },
) => {
  const domain = await ctx.model.findDomain(params.domainId);
  if (!domain) return null;
  const title = params.title.trim();
  const sections: ExpertiseLessonSection[] = [{ body: title, key: 'rule' }];
  for (const key of ['why', 'how', 'limits'] as const) {
    const body = params[key]?.trim();
    if (body) sections.push({ body, key });
  }

  return ctx.db.transaction(async (tx) => {
    const code = await nextLessonCode(tx, params.domainId);
    const [first] = await tx
      .select({ sortOrder: sql<number>`min(${expertiseLessons.sortOrder})` })
      .from(expertiseLessons)
      .where(eq(expertiseLessons.domainId, params.domainId));
    const [row] = await tx
      .insert(expertiseLessons)
      .values({
        code,
        compilability: params.compilability ?? 'not-compilable',
        createdByUserId: ctx.userId,
        direction: params.direction ?? null,
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
 * conversations the system observed on its own. Returns null, writing nothing, when the domain
 * is not one the caller may file into.
 */
export const insertMaterialRun = async (
  ctx: ExpertiseContext,
  params: {
    domainId: string;
    reflectionKey: string;
    subjectId: string;
    subjectType: 'document' | 'standalone' | 'topic';
  },
) => {
  // The domain row lock queues this behind any other writer numbering runs in the same domain
  // (another distillation, background ingestion); otherwise both read the same maximum and the
  // unique `(domain_id, run_index)` index aborts one whole save. Held until the caller commits.
  // Read in the caller's scope, so a foreign domain id is neither locked nor numbered.
  const [domain] = await ctx.db
    .select({ id: expertiseDomains.id })
    .from(expertiseDomains)
    .where(and(eq(expertiseDomains.id, params.domainId), domainScopeWhere(ctx)))
    .for('update');
  if (!domain) return null;
  const [prior] = await ctx.db
    .select({ value: sql<number | null>`max(${expertiseRuns.runIndex})` })
    .from(expertiseRuns)
    .where(eq(expertiseRuns.domainId, params.domainId));
  const [row] = await ctx.db
    .insert(expertiseRuns)
    .values({
      actorId: ctx.userId,
      actorType: 'user',
      completedAt: new Date(),
      domainId: params.domainId,
      hadHumanInLoop: true,
      reflectionKey: params.reflectionKey,
      runIndex: (prior?.value ?? 0) + 1,
      subjectId: params.subjectId,
      subjectType: params.subjectType,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    })
    .returning({ id: expertiseRuns.id });
  return row.id;
};

/**
 * The passage of a material a rule was read from. It is evidence that the material states the
 * rule, not a violation, so it does not add to `hitCount`.
 */
export const insertMaterialHit = async (
  ctx: ExpertiseContext,
  params: {
    domainId: string;
    lessonId: string;
    quote: string;
    runId: string;
    where: string;
  },
) => {
  const [row] = await ctx.db
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
 * Applies one drag inside a group. Only that group's active rules are renumbered; a rule from
 * elsewhere is refused rather than pulled across, because moving between groups changes the
 * code and goes through `moveRule`.
 */
export const reorderRule = async (
  ctx: ExpertiseContext,
  domainId: string,
  lessonId: string,
  beforeId: string | null,
) => {
  const domain = await ctx.model.findDomain(domainId);
  if (!domain) return null;
  return ctx.db.transaction(async (tx) => {
    // The server's own order, not a list sent by the client: a stale or partial client view
    // cannot scramble the group, and the request stays one id no matter how large it grows.
    const rows = await tx
      .select({ id: expertiseLessons.id, sortOrder: expertiseLessons.sortOrder })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')))
      .orderBy(sql`${expertiseLessons.sortOrder} asc nulls last`, asc(expertiseLessons.createdAt));
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
export const moveRule = async (ctx: ExpertiseContext, lessonId: string, domainId: string) => {
  const [lesson, domain] = await Promise.all([
    ctx.model.findLesson(lessonId),
    ctx.model.findDomain(domainId),
  ]);
  if (!lesson || !domain) return null;
  if (lesson.domainId === domainId) return { domainId, id: lessonId };
  // Older clients list every group in the move menu; the boundary has to hold here too.
  if (!(await ctx.model.sameReach(lesson.domainId, domainId))) return null;

  return ctx.db.transaction(async (tx) => {
    // Re-read under a row lock and copy from that: a merge committed since the read above has
    // already folded this rule into another one, and copying it now would leave the same
    // evidence live twice.
    const [current] = await tx
      .select()
      .from(expertiseLessons)
      .where(eq(expertiseLessons.id, lessonId))
      .for('update');
    if (current?.status !== 'active' || current.domainId !== lesson.domainId) return null;

    const code = await nextLessonCode(tx, domainId);
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
