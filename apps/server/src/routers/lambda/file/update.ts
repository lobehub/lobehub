import { type LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { stripAgentShareFileProvenance } from '@/types/files';

import { assertFileNotInRestrictedKnowledgeBase } from '../_helpers/knowledgeBaseAccess';
import { fileProcedure, resolveAccessibleParentDocument } from './procedures';

export const updateProcedures = {
  updateFile: fileProcedure
    .use(withScopedPermission('file:update'))
    .input(
      z.object({
        id: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        name: z.string().optional(),
        parentId: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, metadata, name, parentId } = input;

      const existing = await ctx.fileModel.findById(id);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      await assertFileNotInRestrictedKnowledgeBase(ctx, id);

      // Resolve parentId if it's a slug (otherwise use as-is)
      let resolvedParentId: string | null | undefined = parentId;
      if (parentId) {
        resolvedParentId = (await resolveAccessibleParentDocument(ctx, parentId)).id;
      }

      const updates: Parameters<typeof ctx.fileModel.update>[1] = {};

      if (metadata !== undefined) {
        updates.metadata = stripAgentShareFileProvenance(metadata);
      }

      if (name !== undefined) {
        updates.name = name;
      }

      if (parentId !== undefined) {
        updates.parentId = resolvedParentId;
      }

      if (Object.keys(updates).length > 0) {
        const wsId = ctx.workspaceId ?? undefined;
        await ctx.serverDB.transaction(async (tx) => {
          const trx = tx as unknown as LobeChatDatabase;
          // The knowledge-base tree reads `documents.parent_id`, so the file's
          // backing document row(s) must move (and rename) together with it.
          // Documents are written before the file, matching updateDocument's
          // lock order so concurrent moves cannot deadlock.
          if (updates.parentId !== undefined || updates.name !== undefined) {
            await new DocumentModel(trx, ctx.userId, wsId).syncFromFile(id, {
              name: updates.name,
              parentId: updates.parentId,
            });
          }
          await new FileModel(trx, ctx.userId, wsId).update(id, updates);
        });
      }

      return { success: true };
    }),
  publishFileToWorkspace: fileProcedure
    .use(withScopedPermission('file:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Personal mode has no notion of workspace visibility — publish is only
      // meaningful inside a team workspace.
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot publish a file outside of a workspace',
        });
      }

      const file = await ctx.fileModel.findById(input.id);
      if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });

      if (file.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can publish a private file to the workspace',
        });
      }

      if (file.visibility === 'public') return { success: true };

      await ctx.fileModel.publishToWorkspace(input.id);
      return { success: true };
    }),
  /**
   * Toggle a file's workspace visibility. Creator-only. Personal mode has no
   * workspace visibility concept, so the call is rejected there.
   */
  setFileVisibility: fileProcedure
    .use(withScopedPermission('file:update'))
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
          message: 'File visibility only applies inside a workspace',
        });
      }

      const file = await ctx.fileModel.findById(input.id);
      if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });

      if (file.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can change a file’s visibility',
        });
      }

      if (file.visibility === input.visibility) return { success: true };

      await ctx.fileModel.setVisibility(input.id, input.visibility);
      return { success: true };
    }),
};
