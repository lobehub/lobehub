import { TRASH_RESOURCE_TYPES } from '@lobechat/types';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TrashService } from '@/server/services/trash';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
} from './_helpers/assertWorkspaceRowManageable';

const trashProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: { trashService: new TrashService(ctx.serverDB, ctx.userId, wsId) },
  });
});

const resourceTypeSchema = z.enum(TRASH_RESOURCE_TYPES);

/**
 * Recycle bin. Personal mode lists the caller's own rows; in a workspace the
 * owner sees every root while a non-owner member sees only the roots they
 * trashed themselves — a root's title can be a content excerpt of a resource
 * that member cannot view. Restore / purge apply the
 * same row-level rule as delete did: the member who trashed a row (or any
 * workspace owner) may bring it back or drop it for good.
 */
export const trashRouter = router({
  countByType: trashProcedure.query(async ({ ctx }) =>
    ctx.trashService.countByType({ deletedByUserId: actorFilter(ctx) }),
  ),

  emptyTrash: trashProcedure
    .input(z.object({ resourceType: resourceTypeSchema.optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      // The actor filter is pushed into the query rather than applied to a
      // page of results, so a member with more items than one page still
      // empties all of them.
      return ctx.trashService.emptyTrash({
        deletedByUserId: actorFilter(ctx),
        resourceType: input?.resourceType,
      });
    }),

  list: trashProcedure
    .input(
      z
        .object({
          cursor: z.string().nullish(),
          limit: z.number().int().min(1).max(200).optional(),
          resourceType: resourceTypeSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) =>
      ctx.trashService.list({
        cursor: input?.cursor,
        deletedByUserId: actorFilter(ctx),
        limit: input?.limit,
        resourceType: input?.resourceType,
      }),
    ),

  purge: trashProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      await assertItemsManageable(ctx, input.ids);
      return ctx.trashService.purge(input.ids);
    }),

  restore: trashProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      await assertItemsManageable(ctx, input.ids);
      return ctx.trashService.restore(input.ids);
    }),
});

/** Workspace non-owners only see and sweep the roots they trashed themselves; owners get the whole bin. */
const actorFilter = (ctx: Parameters<typeof isWorkspaceNonOwner>[0] & { userId: string }) =>
  isWorkspaceNonOwner(ctx) ? ctx.userId : undefined;

/** Every requested registry row must be manageable by the caller (creator or workspace owner). */
const assertItemsManageable = async (
  ctx: {
    trashService: TrashService;
    userId: string;
    workspaceId?: string | null;
    workspaceRole?: string;
  },
  ids: string[],
) => {
  if (!ctx.workspaceId) return;
  const items = await ctx.trashService.findByIds(ids);
  for (const item of items) {
    assertWorkspaceRowManageable(ctx, item.deletedByUserId ?? item.userId, 'trash item');
  }
};

export type TrashRouter = typeof trashRouter;
