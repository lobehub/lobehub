import type { TrashProjectFilter, TrashRootFilter, TrashVisibility } from '@lobechat/types';
import { TRASH_RESOURCE_TYPES, TRASH_VISIBILITIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ProjectModel } from '@/database/models/project';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TrashService } from '@/server/services/trash';

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
/** Side of a workspace bin; ignored in personal mode. */
const visibilitySchema = z.enum(TRASH_VISIBILITIES).optional();

/**
 * Recycle bin. A personal bin holds only the caller's rows. A workspace bin
 * has two sides:
 *
 * - `public` — roots every member could see before deletion, whoever deleted
 *   them. Each member restores or purges what they deleted; owners and admins
 *   also manage the rest and may empty the side.
 * - `private` — the caller's own deletions of private resources (or of
 *   resources under a private agent, group or project). Nobody else, owner
 *   included, lists, counts, restores or purges them.
 *
 * A workspace request without a side covers only the caller's own deletions.
 */
export const trashRouter = router({
  countByType: trashProcedure
    .input(z.object({ projectId: projectFilterSchema, visibility: visibilitySchema }).optional())
    .query(async ({ input, ctx }) => {
      await assertProjectFilterReadable(ctx, input?.projectId);
      return ctx.trashService.countByType({
        ...sideFilter(ctx, input?.visibility),
        projectId: input?.projectId,
      });
    }),

  emptyTrash: trashProcedure
    .input(
      z
        .object({
          projectId: projectFilterSchema,
          resourceType: resourceTypeSchema.optional(),
          visibility: visibilitySchema,
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
      if (ctx.workspaceId && input?.visibility === 'public') assertWorkspaceManager(ctx);
      await assertProjectFilterReadable(ctx, input?.projectId);
      // The side filter is pushed into the query rather than applied to a
      // page of results, so a bin larger than one page is still emptied.
      return ctx.trashService.emptyTrash({
        ...sideFilter(ctx, input?.visibility),
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
          visibility: visibilitySchema,
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      await assertProjectFilterReadable(ctx, input?.projectId);
      return ctx.trashService.list({
        ...sideFilter(ctx, input?.visibility),
        cursor: input?.cursor,
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

interface TrashCallerCtx {
  userId: string;
  workspaceId?: string | null;
  workspaceRole?: string;
}

/**
 * What one side of the bin covers for the caller. The private side, and a
 * workspace request without a side, are pinned to the caller's own
 * deletions; personal rows are already the caller's own.
 */
const sideFilter = (
  ctx: TrashCallerCtx,
  visibility: TrashVisibility | undefined,
): Pick<TrashRootFilter, 'deletedByUserId' | 'visibility'> => {
  if (!ctx.workspaceId) return {};
  if (visibility === 'public') return { visibility };
  return { deletedByUserId: ctx.userId, visibility };
};

const isWorkspaceManager = (ctx: TrashCallerCtx) =>
  !!ctx.workspaceId && (ctx.workspaceRole === 'owner' || ctx.workspaceRole === 'admin');

/**
 * Emptying the public side reaches other members' deletions, so it is for
 * workspace owners and admins. Reads `workspaceRole` through the optional ctx
 * field because the OSS `withScopedPermission` stub does not inject it
 * (cloud's override does).
 */
const assertWorkspaceManager = (ctx: TrashCallerCtx) => {
  if (isWorkspaceManager(ctx)) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only a workspace owner or admin can empty the public trash',
  });
};

/**
 * Every requested registry row must be the caller's own deletion, or — for an
 * owner or admin — a public one. A private row stays with whoever deleted it.
 */
const assertItemsManageable = async (
  ctx: TrashCallerCtx & { trashService: TrashService },
  ids: string[],
) => {
  if (!ctx.workspaceId) return;
  const items = await ctx.trashService.findByIds(ids);
  const others = items.filter((item) => (item.deletedByUserId ?? item.userId) !== ctx.userId);
  if (others.length === 0) return;

  const privateIds = isWorkspaceManager(ctx)
    ? await ctx.trashService.findPrivateIds(others.map((item) => item.id))
    : undefined;
  if (privateIds && privateIds.size === 0) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only the member who deleted this trash item can restore or purge it',
  });
};

export type TrashRouter = typeof trashRouter;
