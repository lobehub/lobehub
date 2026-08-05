import { z } from 'zod';

import { SessionGroupModel } from '@/database/models/sessionGroup';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type SessionGroupItem } from '@/types/session';

const sessionProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      sessionGroupModel: new SessionGroupModel(ctx.serverDB, ctx.userId),
    },
  });
});

/**
 * Renaming and reordering only. Deliberately NOT `insertSessionGroupSchema.partial()`:
 * that carries `userId`, `workspaceId` and `visibility`, and folders are now
 * workspace-shared, so the ownership predicate matches every public folder in
 * the workspace. A member could otherwise take another member's Category
 * private, reassign it, or move it out of the workspace — breaking the shared
 * sidebar for everyone and putting the row out of the victim's own reach.
 * Publishing has its own one-way procedure; there is no un-publish by design.
 */
const updatableSessionGroupFields = z.object({
  name: z.string().optional(),
  sort: z.number().nullable().optional(),
});

export const sessionGroupRouter = router({
  createSessionGroup: sessionProcedure
    .input(
      z.object({
        name: z.string(),
        sort: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.sessionGroupModel.create({
        name: input.name,
        sort: input.sort,
      });

      return data?.id;
    }),

  getSessionGroup: sessionProcedure.query(async ({ ctx }): Promise<SessionGroupItem[]> => {
    return ctx.sessionGroupModel.query() as any;
  }),

  removeSessionGroup: sessionProcedure
    .input(z.object({ id: z.string(), removeChildren: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.sessionGroupModel.delete(input.id);
    }),

  updateSessionGroup: sessionProcedure
    .input(
      z.object({
        id: z.string(),
        value: updatableSessionGroupFields,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.sessionGroupModel.update(input.id, input.value);
    }),
  updateSessionGroupOrder: sessionProcedure
    .input(
      z.object({
        sortMap: z.array(
          z.object({
            id: z.string(),
            sort: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.sessionGroupModel.updateOrder(input.sortMap);
    }),
});

export type SessionGroupRouter = typeof sessionGroupRouter;
