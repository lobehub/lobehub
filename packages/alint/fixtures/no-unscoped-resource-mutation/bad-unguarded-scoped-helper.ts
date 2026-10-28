// Fixture: a public scoped-model function updates by a caller-provided id with no local
// guard and no documented caller contract, unlike its siblings.
import { and, eq } from 'drizzle-orm';

import { domainScopeWhere, type ExpertiseContext } from './context';
import { expertiseDomains, expertiseLessons } from './schema';

export const findLesson = async (ctx: ExpertiseContext, lessonId: string) => {
  const [row] = await ctx.db
    .select({ lesson: expertiseLessons })
    .from(expertiseLessons)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
    .where(and(eq(expertiseLessons.id, lessonId), domainScopeWhere(ctx)))
    .limit(1);
  return row?.lesson;
};

export const retireLesson = async (ctx: ExpertiseContext, lessonId: string) => {
  const lesson = await ctx.model.findLesson(lessonId);
  if (!lesson) return null;
  await ctx.db
    .update(expertiseLessons)
    .set({ retiredAt: new Date(), status: 'retired', updatedAt: new Date() })
    .where(eq(expertiseLessons.id, lessonId));
  return { id: lessonId };
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
    // alint-expect
    .where(eq(expertiseLessons.id, lessonId));
};
