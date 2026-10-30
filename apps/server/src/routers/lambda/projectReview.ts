import { PROJECT_MEMBER_ROLES } from '@lobechat/types';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ProjectReviewService } from '@/server/services/projectReview';

const procedure = authedProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: { reviewService: new ProjectReviewService(opts.ctx.serverDB, opts.ctx.userId) },
  }),
);

const projectInput = z.object({ projectId: z.string().min(1) });
const roleSchema = z.enum(PROJECT_MEMBER_ROLES);
const siteFields = {
  name: z.string().trim().min(1).max(255),
  origins: z.array(z.string().max(512)).min(1).max(20),
};

export const projectReviewRouter = router({
  createSite: procedure
    .input(projectInput.extend(siteFields))
    .mutation(({ ctx, input }) =>
      ctx.reviewService.createSite(input.projectId, { name: input.name, origins: input.origins }),
    ),

  deleteSite: procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.reviewService.deleteSite(input.id)),

  listMembers: procedure
    .input(projectInput)
    .query(({ ctx, input }) => ctx.reviewService.listMembers(input.projectId)),

  listSites: procedure
    .input(projectInput)
    .query(({ ctx, input }) => ctx.reviewService.listSites(input.projectId)),

  setMemberRole: procedure
    .input(projectInput.extend({ userId: z.string().min(1), role: roleSchema.nullable() }))
    .mutation(({ ctx, input }) =>
      ctx.reviewService.setMemberRole(input.projectId, input.userId, input.role),
    ),

  updateSite: procedure
    .input(
      z.object({
        id: z.string().min(1),
        name: siteFields.name.optional(),
        origins: siteFields.origins.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.reviewService.updateSite(input.id, { name: input.name, origins: input.origins }),
    ),
});
