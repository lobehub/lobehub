import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileTransferStorageCheck } from '@/business/server/lambda-routers/file';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { DOCUMENT_TRANSFER_FOREIGN_ROWS } from '@/database/models/document';
import { router } from '@/libs/trpc/lambda';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
} from '../_helpers/assertWorkspaceRowManageable';
import { fileProcedure } from './procedures';

const fileTransferEntityTypeSchema = z.enum(['document', 'file', 'folder']);

export const transferRouter = router({
  transferEntity: fileProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        entityType: fileTransferEntityTypeSchema,
        id: z.string(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetWorkspaceId === (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer to the same workspace',
        });
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'FILE_UPLOAD',
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

      if (input.entityType === 'folder' || input.entityType === 'document') {
        const document = await ctx.documentModel.findById(input.id);
        if (!document) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.ResourceNotFound } },
            code: 'NOT_FOUND',
            message: input.entityType === 'folder' ? 'Folder not found' : 'Document not found',
          });
        }
        // Transfer stays creator-only, mirroring `document.transferDocument`.
        if (ctx.workspaceId) {
          await assertCanPerformResourceAction({
            action: 'transfer',
            db: ctx.serverDB,
            resourceId: input.id,
            resourceType: 'document',
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          });
        }
        const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.id);
        await businessFileTransferStorageCheck({
          additionalSize,
          targetUserId: ctx.userId,
          targetWorkspaceId: input.targetWorkspaceId,
        });
        // The transfer rehomes the entire subtree — a non-owner member must
        // not move teammates' documents/files/likes along with their own
        // folder. The guard runs INSIDE the transfer transaction (after the
        // subtree rows are locked) so content committed between any preflight
        // and the transfer cannot slip past it; see `document.transferDocument`.
        try {
          return await ctx.documentModel.transferTo(
            input.id,
            input.targetWorkspaceId,
            ctx.userId,
            input.targetVisibility,
            { forbidForeignRows: isWorkspaceNonOwner(ctx) },
          );
        } catch (error) {
          if (error instanceof Error && error.message === DOCUMENT_TRANSFER_FOREIGN_ROWS) {
            throw new TRPCError({
              cause: { data: { code: TransferErrorCode.OwnerOnly } },
              code: 'FORBIDDEN',
              message: "Only workspace owners can transfer a folder containing others' content",
            });
          }
          throw error;
        }
      }

      const file = await ctx.fileModel.findById(input.id);
      if (!file)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'File not found',
        });
      assertWorkspaceRowManageable(ctx, file.userId, 'file');
      await businessFileTransferStorageCheck({
        additionalSize: file.size,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });
      return ctx.fileModel.transferTo(
        input.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),
  copyEntityToWorkspace: fileProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        entityType: fileTransferEntityTypeSchema,
        id: z.string(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'FILE_UPLOAD',
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

      if (input.entityType === 'folder' || input.entityType === 'document') {
        const document = await ctx.documentModel.findById(input.id);
        if (!document) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.ResourceNotFound } },
            code: 'NOT_FOUND',
            message: input.entityType === 'folder' ? 'Folder not found' : 'Document not found',
          });
        }
        const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.id);
        await businessFileTransferStorageCheck({
          additionalSize,
          targetUserId: ctx.userId,
          targetWorkspaceId: input.targetWorkspaceId,
        });
        return ctx.documentModel.copyToWorkspace(
          input.id,
          input.targetWorkspaceId,
          ctx.userId,
          input.targetVisibility,
        );
      }

      const file = await ctx.fileModel.findById(input.id);
      if (!file)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'File not found',
        });
      await businessFileTransferStorageCheck({
        additionalSize: file.size,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });
      return ctx.fileModel.copyToWorkspace(
        input.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),
});
