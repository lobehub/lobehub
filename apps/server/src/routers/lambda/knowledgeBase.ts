import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileTransferStorageCheck } from '@/business/server/lambda-routers/file';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { serverDBEnv } from '@/config/db';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { DEFAULT_RESOURCE_ACCESS_LEVELS, insertKnowledgeBasesSchema } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import {
  getWorkspaceScopedPermissionMatches,
  hasWorkspaceScopedPermission,
} from '@/server/services/workspacePermission';
import { type KnowledgeBaseItem } from '@/types/knowledgeBase';
import { TransferErrorCode } from '@/types/transferError';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
} from './_helpers/assertWorkspaceRowManageable';
import {
  assertKnowledgeBaseBrowsable,
  filterRestrictedKnowledgeBases,
  getUseLevelKnowledgeBaseIds,
} from './_helpers/knowledgeBaseAccess';

const knowledgeBaseProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const knowledgeBaseRouter = router({
  addFilesToKnowledgeBase: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:update'))
    .input(z.object({ ids: z.array(z.string()), knowledgeBaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // KB file membership is not in the co-edit list — creator/owner only.
      const kb = await ctx.knowledgeBaseModel.findById(input.knowledgeBaseId);
      if (!kb) throw new TRPCError({ code: 'NOT_FOUND', message: 'Knowledge base not found' });
      assertWorkspaceRowManageable(ctx, kb.userId, 'knowledge base');

      try {
        return await ctx.knowledgeBaseModel.addFilesToKnowledgeBase(
          input.knowledgeBaseId,
          input.ids,
        );
      } catch (e: any) {
        // Check for PostgreSQL unique constraint violation (code 23505)
        const pgErrorCode = e?.cause?.cause?.code || e?.cause?.code || e?.code;
        if (pgErrorCode === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'FILE_ALREADY_IN_KNOWLEDGE_BASE',
          });
        }
        throw e;
      }
    }),

  createKnowledgeBase: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:create'))
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.knowledgeBaseModel.create({
        avatar: input.avatar,
        description: input.description,
        name: input.name,
        visibility: input.visibility,
      });

      return data?.id;
    }),

  copyKnowledgeBaseToWorkspace: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:create'))
    .input(
      z.object({
        id: z.string(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const knowledgeBase = await ctx.knowledgeBaseModel.findById(input.id);
      if (!knowledgeBase) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Knowledge base not found',
        });
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'KNOWLEDGE_BASE_CREATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });
        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      const additionalSize = await ctx.knowledgeBaseModel.countFileUsage(input.id);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      return ctx.knowledgeBaseModel.copyToWorkspace(
        input.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),

  getKnowledgeBaseById: knowledgeBaseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<KnowledgeBaseItem | undefined> => {
      const kb = await ctx.knowledgeBaseModel.findById(input.id);
      if (!kb) return kb;

      // Restricted KBs (resource-permission `use` level) stay mountable but
      // their detail/content view is manager-only.
      await assertKnowledgeBaseBrowsable(ctx, input.id, {
        userId: kb.userId,
        visibility: kb.visibility ?? null,
        workspaceId: kb.workspaceId ?? null,
      });

      return kb;
    }),

  getKnowledgeBases: knowledgeBaseProcedure
    .input(
      z
        .object({
          visibility: z.enum(['private', 'public']).optional(),
        })
        .optional(),
    )
    .query(
      async ({
        ctx,
        input,
      }): Promise<
        (KnowledgeBaseItem & { memberRestricted?: boolean; permissionManageable?: boolean })[]
      > => {
        const list = await ctx.knowledgeBaseModel.query({ visibility: input?.visibility });

        // Restricted KBs are fully hidden from non-privileged members here; the
        // agent knowledge picker lists them through `agent.getKnowledgeBasesAndFiles`.
        const visible = await filterRestrictedKnowledgeBases(ctx, list);

        // Managers keep seeing restricted KBs — flag them (and who may manage
        // permissions) so the client renders the lock badge and the
        // permission-page entry without a per-row permission request.
        if (!ctx.workspaceId) return visible;
        const [useLevelIds, { hasAllScope }] = await Promise.all([
          getUseLevelKnowledgeBaseIds(ctx.serverDB, ctx.workspaceId),
          getWorkspaceScopedPermissionMatches({
            action: 'KNOWLEDGE_BASE_UPDATE',
            db: ctx.serverDB,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          }),
        ]);
        const useLevelSet = new Set(useLevelIds);
        return visible.map((kb) => ({
          ...kb,
          memberRestricted: useLevelSet.has(kb.id),
          permissionManageable: hasAllScope || kb.userId === ctx.userId,
        }));
      },
    ),

  publishKnowledgeBaseToWorkspace: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot publish a knowledge base outside of a workspace',
        });
      }

      const kb = await ctx.knowledgeBaseModel.findById(input.id);
      if (!kb) throw new TRPCError({ code: 'NOT_FOUND', message: 'Knowledge base not found' });

      if (kb.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can publish a private knowledge base to the workspace',
        });
      }

      await ctx.knowledgeBaseModel.publishToWorkspace(input.id);
      return { success: true };
    }),

  /**
   * Toggle a knowledge base's workspace visibility. Creator-only. Personal
   * mode has no workspace visibility concept, so the call is rejected there.
   */
  setKnowledgeBaseVisibility: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:update'))
    .input(
      z.object({
        id: z.string(),
        visibility: z.enum(['private', 'public']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Knowledge base visibility only applies inside a workspace',
        });
      }

      const kb = await ctx.knowledgeBaseModel.findById(input.id);
      if (!kb) throw new TRPCError({ code: 'NOT_FOUND', message: 'Knowledge base not found' });

      if (kb.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can change a knowledge base’s visibility',
        });
      }

      await ctx.knowledgeBaseModel.setVisibility(input.id, input.visibility);
      return { success: true };
    }),

  removeAllKnowledgeBases: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:delete'))
    .mutation(async ({ ctx }) => {
      // Workspace clear-all is caller-scoped for every role — owners included
      // (per docs/usage/workspace-permissions: bulk actions only affect
      // caller-created content).
      const restrictToCreator = !!ctx.workspaceId;

      const result = await ctx.knowledgeBaseModel.deleteAllWithFiles(
        serverDBEnv.REMOVE_GLOBAL_FILE,
        { restrictToCreator },
      );

      if (result.deletedFiles.length > 0) {
        const fileService = new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const urls = result.deletedFiles.map((f) => f.url).filter(Boolean) as string[];
        if (urls.length > 0) {
          await fileService.deleteFiles(urls);
        }
      }
    }),

  removeFilesFromKnowledgeBase: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:update'))
    .input(z.object({ ids: z.array(z.string()), knowledgeBaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // KB file membership is not in the co-edit list — creator/owner only.
      const kb = await ctx.knowledgeBaseModel.findById(input.knowledgeBaseId);
      if (!kb) throw new TRPCError({ code: 'NOT_FOUND', message: 'Knowledge base not found' });
      assertWorkspaceRowManageable(ctx, kb.userId, 'knowledge base');

      return ctx.knowledgeBaseModel.removeFilesFromKnowledgeBase(input.knowledgeBaseId, input.ids);
    }),

  removeKnowledgeBase: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.knowledgeBaseModel.findById(input.id);
      if (!existing) return;
      assertWorkspaceRowManageable(ctx, existing.userId, 'knowledge base');

      const result = await ctx.knowledgeBaseModel.deleteWithFiles(
        input.id,
        serverDBEnv.REMOVE_GLOBAL_FILE,
        { restrictToCreator: isWorkspaceNonOwner(ctx) },
      );

      if (result.deletedFiles.length > 0) {
        const fileService = new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const urls = result.deletedFiles.map((f) => f.url).filter(Boolean) as string[];
        if (urls.length > 0) {
          await fileService.deleteFiles(urls);
        }
      }
    }),

  transferKnowledgeBase: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:create'))
    .input(
      z.object({
        id: z.string(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.targetWorkspaceId === (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer to the same workspace',
        });
      }

      const knowledgeBase = await ctx.knowledgeBaseModel.findById(input.id);
      if (!knowledgeBase) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Knowledge base not found',
        });
      }
      assertWorkspaceRowManageable(ctx, knowledgeBase.userId, 'knowledge base');
      // The transfer rehomes every linked file/document — a non-owner member
      // must not move teammates' rows along with their own KB.
      if (
        isWorkspaceNonOwner(ctx) &&
        (await ctx.knowledgeBaseModel.hasForeignLinkedRows(input.id))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only workspace owners can transfer a knowledge base containing others' files",
        });
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'KNOWLEDGE_BASE_CREATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });
        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      const additionalSize = await ctx.knowledgeBaseModel.countFileUsage(input.id);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      const result = await ctx.knowledgeBaseModel.transferTo(
        input.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
      // Mirror the agent/document transfer paths: the source workspace's
      // permission row must not survive the move, and a public arrival gets
      // the default level in the destination.
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'knowledgeBase',
          input.id,
        );
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        await new ResourcePermissionModel(ctx.serverDB, input.targetWorkspaceId).setAccessLevel(
          'knowledgeBase',
          input.id,
          DEFAULT_RESOURCE_ACCESS_LEVELS.knowledgeBase,
          ctx.userId,
        );
      }
      return result;
    }),

  updateKnowledgeBase: knowledgeBaseProcedure
    .use(withScopedPermission('knowledge_base:update'))
    .input(
      z.object({
        id: z.string(),
        value: insertKnowledgeBasesSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.knowledgeBaseModel.findById(input.id);
      if (!existing) return;
      assertWorkspaceRowManageable(ctx, existing.userId, 'knowledge base');

      return ctx.knowledgeBaseModel.update(input.id, input.value);
    }),
});
