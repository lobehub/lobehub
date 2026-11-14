import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type SessionGroupItem } from '@/types/session';

import { assertCanWriteTeamPin } from './_helpers/sidebarPin';

const sessionProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      sessionGroupModel: new SessionGroupModel(ctx.serverDB, ctx.userId, wsId),
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

  getSessionGroup: sessionProcedure
    // Folders are shared workspace structure now, so listing them is what
    // `session_group:read` exists to gate. Without this the permission is
    // declared but unenforceable.
    .use(withScopedPermission('session_group:read'))
    .query(async ({ ctx }): Promise<SessionGroupItem[]> => {
      return ctx.sessionGroupModel.query() as any;
    }),

  // NOTE: no row-level creator check on the mutations below (unlike other
  // workspace-shared resources). Sidebar organization is a per-member concern
  // now (section layout / agent membership live in workspace_user_settings),
  // so folder management stays open to every member holding the
  // session_group:update/delete scope instead of being creator/owner-gated.
  removeSessionGroup: sessionProcedure
    .use(withScopedPermission('session_group:delete'))
    .input(z.object({ id: z.string(), removeChildren: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.sessionGroupModel.delete(input.id);
    }),

  updateSessionGroup: sessionProcedure
    .use(withScopedPermission('session_group:update'))
    .input(
      z.object({
        id: z.string(),
        value: updatableSessionGroupFields,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.sessionGroupModel.update(input.id, input.value);
    }),
  /**
   * Team pin of a public workspace folder — owners/admins only, the same grant
   * as the Agent / chat-group team pin. Members pin a folder for themselves
   * through `workspace_user_settings.sidebarPinnedItemIds`.
   */
  updateSessionGroupTeamPinned: sessionProcedure
    .use(withScopedPermission('session_group:update'))
    .input(z.object({ id: z.string(), pinned: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspaceId)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Team pins only exist in a workspace',
        });

      await assertCanWriteTeamPin(ctx);

      const updated = await ctx.sessionGroupModel.updateTeamPinned(input.id, input.pinned);
      if (!updated)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Only a public workspace folder can be pinned for the team',
        });
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
