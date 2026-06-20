import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { isSuperAdmin } from '../enterprise/superAdmin';

const workspaceProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceAuditLogModel: new WorkspaceAuditLogModel(ctx.serverDB),
      workspaceMemberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

const assertOwner = async (
  ctx: {
    serverDB: LobeChatDatabase;
    userId: string;
    workspaceMemberModel: WorkspaceMemberModel;
  },
  workspaceId: string,
) => {
  const membership = await ctx.workspaceMemberModel.getMember(workspaceId, ctx.userId);
  if (await isSuperAdmin(ctx.serverDB, ctx.userId)) return;
  if (membership?.role !== 'owner') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only workspace owners can perform this action',
    });
  }
};

const slugSchema = z
  .string()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i, 'Use letters, numbers, and hyphens');

const stableNumericId = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
};

export const workspaceRouter = router({
  create: workspaceProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().min(1).max(255),
        slug: slugSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.workspaceModel.findBySlug(input.slug);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Workspace slug already exists' });
      }

      const workspace = await ctx.workspaceModel.create(input);
      await ctx.workspaceAuditLogModel.create({
        action: 'workspace.created',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: { slug: workspace.slug },
        resourceId: workspace.id,
        resourceType: 'workspace',
        userId: ctx.userId,
        workspaceId: workspace.id,
      });

      return workspace;
    }),

  delete: workspaceProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.id);
      await ctx.workspaceAuditLogModel.create({
        action: 'workspace.deleted',
        ipAddress: ctx.clientIp ?? undefined,
        resourceId: input.id,
        resourceType: 'workspace',
        userId: ctx.userId,
        workspaceId: input.id,
      });
      if (await isSuperAdmin(ctx.serverDB, ctx.userId)) {
        await ctx.serverDB.delete(workspaces).where(eq(workspaces.id, input.id));
      } else {
        await ctx.workspaceModel.delete(input.id);
      }
    }),

  ensureMarketOrganization: workspaceProcedure.mutation(
    async ({ ctx }): Promise<{ marketAccountId: number }> => ({
      marketAccountId: stableNumericId(ctx.workspaceId || ctx.userId),
    }),
  ),

  list: workspaceProcedure.query(async ({ ctx }) => {
    if (await isSuperAdmin(ctx.serverDB, ctx.userId)) {
      const items = await ctx.serverDB.query.workspaces.findMany({
        orderBy: (table, { desc }) => [desc(table.updatedAt)],
      });

      return items.map((workspace) => ({ ...workspace, role: 'super_admin' }));
    }

    return ctx.workspaceModel.listUserWorkspaces();
  }),

  update: workspaceProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        slug: slugSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...value } = input;
      await assertOwner(ctx, id);

      if (value.slug) {
        const existing = await ctx.workspaceModel.findBySlug(value.slug);
        if (existing && existing.id !== id) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Workspace slug already exists' });
        }
      }

      await ctx.workspaceModel.update(id, value);
      await ctx.workspaceAuditLogModel.create({
        action: 'workspace.updated',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: value,
        resourceId: id,
        resourceType: 'workspace',
        userId: ctx.userId,
        workspaceId: id,
      });
    }),
});
