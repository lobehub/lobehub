import { TRASH_MUTATION_BATCH_SIZE } from '@lobechat/const';
import type { TrashResourceType } from '@lobechat/types';
import { TRASH_RESOURCE_TYPES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TrashService } from '@/server/services/trash';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

const trashProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: { trashService: new TrashService(ctx.serverDB, ctx.userId, wsId) },
  });
});
const trashHighRiskProcedure = trashProcedure.use(requireWorkspaceRoleWhenScoped('admin'));

const resourceTypeSchema = z.enum(TRASH_RESOURCE_TYPES);

/**
 * Recycle bin. Listing is scoped like the content it indexes (own rows in
 * personal mode, the whole workspace in team mode). Members may restore every
 * visible Resource; permanent deletion remains an explicit Admin/Owner action.
 */
export const trashRouter = router({
  countByType: trashProcedure.query(async ({ ctx }) => ctx.trashService.countByType()),

  emptyTrash: trashHighRiskProcedure
    .input(z.object({ resourceType: resourceTypeSchema.optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        const resourceTypes = input?.resourceType ? [input.resourceType] : TRASH_RESOURCE_TYPES;
        await Promise.all(
          resourceTypes.map((resourceType) => assertResourceCapability(ctx, resourceType, 'purge')),
        );
      }
      return ctx.trashService.emptyTrash({
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
        limit: input?.limit,
        resourceType: input?.resourceType,
      }),
    ),

  purge: trashHighRiskProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(TRASH_MUTATION_BATCH_SIZE) }))
    .mutation(async ({ input, ctx }) => {
      await assertItemsManageable(ctx, input.ids, 'purge');
      return ctx.trashService.purge(input.ids);
    }),

  restore: trashProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(TRASH_MUTATION_BATCH_SIZE) }))
    .mutation(async ({ input, ctx }) => {
      await assertItemsManageable(ctx, input.ids, 'restore');
      return ctx.trashService.restore(input.ids);
    }),
});

/** Every requested registry row must be visible and manageable by the caller. */
const assertItemsManageable = async (
  ctx: {
    trashService: TrashService;
    userId: string;
    workspaceId?: string | null;
    workspaceRole?: string;
  },
  ids: string[],
  operation: 'purge' | 'restore',
) => {
  const items = await ctx.trashService.findByIds(ids);
  const foundIds = new Set(items.map((item) => item.id));
  if ([...new Set(ids)].some((id) => !foundIds.has(id))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more trash items were not found' });
  }
  if (!ctx.workspaceId) return;
  for (const item of items) {
    if (item.meta?.visibility === 'private' && item.meta.creatorUserId !== ctx.userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Trash item is not accessible' });
    }
    await assertResourceCapability(ctx, item.resourceType, operation);
  }
};

const assertResourceCapability = async (
  ctx: { serverDB?: unknown; userId: string; workspaceId?: string | null },
  resourceType: TrashResourceType,
  operation: 'purge' | 'restore',
) => {
  if (!ctx.workspaceId || !ctx.serverDB) return;
  const action = {
    document: operation === 'purge' ? 'DOCUMENT_DELETE' : 'DOCUMENT_UPDATE',
    file: operation === 'purge' ? 'FILE_DELETE' : 'FILE_UPDATE',
    knowledgeBase: operation === 'purge' ? 'KNOWLEDGE_BASE_DELETE' : 'KNOWLEDGE_BASE_UPDATE',
  }[resourceType] as
    | 'DOCUMENT_DELETE'
    | 'DOCUMENT_UPDATE'
    | 'FILE_DELETE'
    | 'FILE_UPDATE'
    | 'KNOWLEDGE_BASE_DELETE'
    | 'KNOWLEDGE_BASE_UPDATE';
  const allowed = await hasWorkspaceScopedPermission({
    action,
    db: ctx.serverDB as Parameters<typeof hasWorkspaceScopedPermission>[0]['db'],
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No permission to manage this trash item' });
  }
};

export type TrashRouter = typeof trashRouter;
