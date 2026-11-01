import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { UserSkillService } from '@/server/services/userSkill';

/** The user's own skill library: skills that belong to the user, not to one agent. */
const userSkillProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      userSkillService: new UserSkillService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const userSkillRouter = router({
  /** One skill with every version it went through, oldest first. */
  get: userSkillProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => (await ctx.userSkillService.getSkill(input.id)) ?? null),
});

export type UserSkillRouter = typeof userSkillRouter;
