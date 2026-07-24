import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import { insertSessionGroupSchema } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type SessionGroupItem } from '@/types/session';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const sessionProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      sessionGroupModel: new SessionGroupModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const sessionGroupRouter = router({
  createSessionGroup: sessionProcedure
    .use(withScopedPermission('session_group:create'))
    .input(
      z.object({
        name: z.string(),
        sort: z.number().optional(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.sessionGroupModel.create({
        name: input.name,
        sort: input.sort,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      });

      return data?.id;
    }),

  /**
   * Publish a private folder into the workspace. One-way — mirrors the
   * agent/chatGroup rule: once shared, other members may have anchored their
   * own work to it, so we never re-privatize.
   */
  publishSessionGroupToWorkspace: sessionProcedure
    .use(withScopedPermission('session_group:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.sessionGroupModel.publishToWorkspace(input.id);
    }),

  getSessionGroup: sessionProcedure.query(async ({ ctx }): Promise<SessionGroupItem[]> => {
    return ctx.sessionGroupModel.query() as any;
  }),

  removeSessionGroup: sessionProcedure
    .use(withScopedPermission('session_group:delete'))
    .input(z.object({ id: z.string(), removeChildren: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const group = await ctx.sessionGroupModel.findById(input.id);
      if (group) assertWorkspaceRowManageable(ctx, group.userId, 'session group');

      return ctx.sessionGroupModel.delete(input.id);
    }),

  updateSessionGroup: sessionProcedure
    .use(withScopedPermission('session_group:update'))
    .input(
      z.object({
        id: z.string(),
        value: insertSessionGroupSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const group = await ctx.sessionGroupModel.findById(input.id);
      if (group) assertWorkspaceRowManageable(ctx, group.userId, 'session group');

      return ctx.sessionGroupModel.update(input.id, input.value);
    }),
  updateSessionGroupOrder: sessionProcedure
    .use(withScopedPermission('session_group:update'))
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
      console.info('sortMap:', input.sortMap);

      return ctx.sessionGroupModel.updateOrder(input.sortMap);
    }),
});

export type SessionGroupRouter = typeof sessionGroupRouter;
