// Fixture: every updated id comes from a select filtered by a parent that was authorized
// fail-closed first.
import { and, asc, eq } from 'drizzle-orm';

import type { ExpertiseContext } from './context';
import { expertiseLessons } from './schema';

export const reorderRule = async (
  ctx: ExpertiseContext,
  domainId: string,
  lessonId: string,
  beforeId: string | null,
) => {
  const domain = await ctx.model.findDomain(domainId);
  if (!domain) return null;
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: expertiseLessons.id, sortOrder: expertiseLessons.sortOrder })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domain.id), eq(expertiseLessons.status, 'active')))
      .orderBy(asc(expertiseLessons.sortOrder));
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
