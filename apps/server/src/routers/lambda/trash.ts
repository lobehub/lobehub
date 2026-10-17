import type { TrashProjectFilter } from '@lobechat/types';
import { TRASH_RESOURCE_TYPES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ProjectModel } from '@/database/models/project';
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
    ctx: {
      projectModel: new ProjectModel(ctx.serverDB, ctx.userId, wsId),
      trashService: new TrashService(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const resourceTypeSchema = z.enum(TRASH_RESOURCE_TYPES);
/** `undefined` = every project, `null` = roots without a project, a string = that project. */
const projectFilterSchema = z.string().min(1).nullable().optional();

/**
 * Recycle bin. Personal mode lists the caller's own rows; in a workspace the
 * owner sees every root while a non-owner member sees only the roots they
 * trashed themselves — a root's title can be a content excerpt of a resource
 * that member cannot view. Restore / purge apply the
 * same row-level rule as delete did: the member who trashed a row (or any
 * workspace owner) may bring it back or drop it for good.
 */
export const trashRouter = router({
  countByType: trashProcedure
    .input(z.object({ projectId: projectFilterSchema }).optional())
    .query(async ({ input, ctx }) => {
      await assertProjectFilterReadable(ctx, input?.projectId);
      return ctx.trashService.countByType({
        deletedByUserId: actorFilter(ctx),
        projectId: input?.projectId,
      });
    }),

  emptyTrash: trashProcedure
    .input(
      z
        .object({
          projectId: projectFilterSchema,
          resourceType: resourceTypeSchema.optional(),
          /**
           * Scope the client started emptying in (`null` = personal). The
           * request's own workspace context still decides what is reachable;
           * this only refuses a batch that would land in another scope after
           * the user switched workspace mid-sweep, so a sweep never widens.
           */
          workspaceId: z.string().nullable().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input, ctx }) => {
      if (input?.workspaceId !== undefined && input.workspaceId !== (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The active workspace changed while emptying the trash',
        });
      }
      await assertProjectFilterReadable(ctx, input?.projectId);
      // The actor filter is pushed into the query rather than applied to a
      // page of results, so a member with more items than one page still
      // empties all of them.
      return ctx.trashService.emptyTrash({
        deletedByUserId: actorFilter(ctx),
        projectId: input?.projectId,
        resourceType: input?.resourceType,
      });
    }),

  list: trashProcedure
    .input(
      z
        .object({
          cursor: z.string().nullish(),
          limit: z.number().int().min(1).max(200).optional(),
          projectId: projectFilterSchema,
          resourceType: resourceTypeSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      await assertProjectFilterReadable(ctx, input?.projectId);
      return ctx.trashService.list({
        cursor: input?.cursor,
        deletedByUserId: actorFilter(ctx),
        limit: input?.limit,
        projectId: input?.projectId,
        resourceType: input?.resourceType,
      });
    }),

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

/**
 * A project filter must name a project the caller can read in the current
 * scope — the same visibility the project list applies (scope, private
 * projects of other members, deleted projects). Filtering by any other id
 * would let the caller probe which roots belong to a project they cannot see,
 * or sweep by it; a deleted or revoked project is reported as `NOT_FOUND` so
 * the client can tell "project unavailable" from "nothing in it".
 */
const assertProjectFilterReadable = async (
  ctx: { projectModel: ProjectModel },
  projectId: TrashProjectFilter,
) => {
  if (typeof projectId !== 'string') return;
  if (await ctx.projectModel.findById(projectId)) return;
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
};

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
