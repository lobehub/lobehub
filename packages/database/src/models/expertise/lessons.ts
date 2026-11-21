import {
  EXPERTISE_RULE_DIRECTIONS,
  type ExpertiseLessonSection,
  type ExpertiseRuleDirection,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { expertiseDomains, expertiseLessonRevisions, expertiseLessons } from '../../schemas';
import { domainScopeWhere, type ExpertiseContext } from './context';

export const findLesson = async (ctx: ExpertiseContext, lessonId: string) => {
  const [row] = await ctx.db
    .select({ lesson: expertiseLessons })
    .from(expertiseLessons)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
    .where(and(eq(expertiseLessons.id, lessonId), domainScopeWhere(ctx)))
    .limit(1);
  return row?.lesson;
};

/** Stores a lesson the user taught directly; it takes effect on the next matching practice. */
export const teachLesson = async (
  ctx: ExpertiseContext,
  params: { domainId: string; text: string },
) => {
  const domain = await ctx.model.findDomain(params.domainId);
  if (!domain) return null;
  const text = params.text.trim();
  const title = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return ctx.db.transaction(async (tx) => {
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
        createdByUserId: ctx.userId,
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
export const reviseLesson = async (ctx: ExpertiseContext, lessonId: string, feedback: string) => {
  const lesson = await ctx.model.findLesson(lessonId);
  if (!lesson) return null;
  const text = feedback.trim();
  const sections: ExpertiseLessonSection[] = [
    ...lesson.sections.filter((s) => s.key !== 'limits'),
    { body: text, key: 'limits' },
  ];
  const revision = lesson.currentRevision + 1;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(expertiseLessonRevisions).values({
      changedBy: 'user',
      changedByUserId: ctx.userId,
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
export const listLessonRevisions = async (ctx: ExpertiseContext, lessonId: string, limit = 10) => {
  // A rule re-filed into another group is a copy; its earlier edits stay on the row it was
  // copied from. Follow `salvagedFromId` back so the history reads as one rule's. Merged-in
  // rules are not followed: their edits were to a different sentence.
  const chain = [lessonId];
  for (let depth = 0; depth < 16; depth += 1) {
    const [row] = await ctx.db
      .select({ salvagedFromId: expertiseLessons.salvagedFromId })
      .from(expertiseLessons)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
      .where(and(eq(expertiseLessons.id, chain.at(-1)!), domainScopeWhere(ctx)))
      .limit(1);
    const previous = row?.salvagedFromId;
    if (!previous || chain.includes(previous)) break;
    chain.push(previous);
  }
  const rows = await ctx.db
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
    .where(and(inArray(expertiseLessonRevisions.lessonId, chain), domainScopeWhere(ctx)))
    .orderBy(desc(expertiseLessonRevisions.revision), desc(expertiseLessonRevisions.createdAt))
    .limit(limit);
  // In a shared group any member can edit; the reader is told whether an edit was theirs, and
  // the other member's id does not leave the server.
  return rows.map(({ changedByUserId, ...row }) => ({
    ...row,
    byViewer: changedByUserId === ctx.userId,
  }));
};

/** Brings a retired standard back into practice. */
export const restoreLesson = async (ctx: ExpertiseContext, lessonId: string) => {
  const lesson = await ctx.model.findLesson(lessonId);
  if (!lesson) return null;
  // A rule archived by a merge already lives on inside its target: its counts were added there
  // and its evidence is read through the target's lineage. Bringing it back would count the
  // same history twice, so it stays archived.
  if (lesson.rejectedReason?.startsWith('merged-into:')) return null;
  await ctx.db
    .update(expertiseLessons)
    .set({ retiredAt: null, status: 'active', updatedAt: new Date() })
    .where(eq(expertiseLessons.id, lessonId));
  return { id: lessonId };
};

/**
 * The same row `findLesson` returns, read under a row lock for the rest of the caller's
 * transaction. Anything computed from it — the next revision number, a section patch, merged
 * counts — stays valid until commit, so a concurrent edit waits instead of being overwritten.
 */
export const lockLesson = async (ctx: ExpertiseContext, lessonId: string) => {
  const [row] = await ctx.db
    .select({ lesson: expertiseLessons })
    .from(expertiseLessons)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
    .where(and(eq(expertiseLessons.id, lessonId), domainScopeWhere(ctx)))
    .for('update', { of: expertiseLessons })
    .limit(1);
  return row?.lesson;
};

/** Appends one entry to a lesson's edit history. */
export const insertLessonRevision = async (
  ctx: ExpertiseContext,
  values: typeof expertiseLessonRevisions.$inferInsert,
) => {
  await ctx.db.insert(expertiseLessonRevisions).values(values);
};

/** Writes fields of one lesson row; `updatedAt` is always refreshed. */
export const updateLessonFields = async (
  ctx: ExpertiseContext,
  lessonId: string,
  fields: Partial<typeof expertiseLessons.$inferInsert>,
) => {
  await ctx.db
    .update(expertiseLessons)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(expertiseLessons.id, lessonId));
};

/**
 * Writes judged directions onto rules that still have none. A rule the reviewer flipped while
 * the judgment was in flight keeps their choice: only null rows are filled.
 */
export const fillLessonDirections = async (
  ctx: ExpertiseContext,
  judged: { direction: ExpertiseRuleDirection; id: string }[],
) => {
  for (const direction of EXPERTISE_RULE_DIRECTIONS) {
    const ids = judged.filter((rule) => rule.direction === direction).map((rule) => rule.id);
    if (ids.length === 0) continue;
    await ctx.db
      .update(expertiseLessons)
      .set({ direction, updatedAt: new Date() })
      .where(and(inArray(expertiseLessons.id, ids), isNull(expertiseLessons.direction)));
  }
};

/** Retires a lesson so it stops being practiced; the record and its evidence are kept. */
export const retireLesson = async (ctx: ExpertiseContext, lessonId: string) => {
  const lesson = await ctx.model.findLesson(lessonId);
  if (!lesson) return null;
  await ctx.db
    .update(expertiseLessons)
    .set({ retiredAt: new Date(), status: 'retired', updatedAt: new Date() })
    .where(eq(expertiseLessons.id, lessonId));
  return { id: lessonId };
};
