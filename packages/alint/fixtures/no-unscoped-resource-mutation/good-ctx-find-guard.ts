// Fixture: `ctx.model.findDomain` is the scoped lookup that fails closed before the write;
// its body lives in another file.
import { eq } from 'drizzle-orm';

import type { ExpertiseContext } from './context';
import { expertiseDomains } from './schema';

/** Renames a group; the gate question can be changed the same way. */
export const updateRuleGroup = async (
  ctx: ExpertiseContext,
  domainId: string,
  patch: { gate?: string; title?: string },
) => {
  const domain = await ctx.model.findDomain(domainId);
  if (!domain) return null;
  const title = patch.title?.trim();
  const gate = patch.gate?.trim();
  await ctx.db
    .update(expertiseDomains)
    .set({
      ...(title && { title }),
      ...(gate && { domainFilter: gate }),
      updatedAt: new Date(),
    })
    .where(eq(expertiseDomains.id, domainId));
  return { id: domainId };
};
