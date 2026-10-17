import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileTransferStorageCheck } from '@/business/server/lambda-routers/file';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { DOCUMENT_TRANSFER_FOREIGN_ROWS } from '@/database/models/document';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import {
  assertCanPerformResourceAction,
  buildResourcePermissionState,
} from '@/server/services/resourcePermission';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from '../_helpers/assertWorkspaceRowManageable';
import { documentProcedure } from './procedures';

export const workspaceProcedures = {
  transferDocument: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        documentId: z.string(),
        targetAccessLevel: z.enum(['view', 'edit']).optional(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.documentModel.findById(input.documentId);
      if (!doc)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Document not found',
        });

      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'transfer',
          db: ctx.serverDB,
          resourceId: input.documentId,
          resourceType: 'document',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      if (input.targetWorkspaceId === (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer document to the same workspace',
        });
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'DOCUMENT_CREATE',
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

      const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.documentId);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      // The transfer rehomes every descendant document, anchored file, comment,
      // and like. A non-owner member may transfer their own root only when the
      // entire subtree is theirs; workspace owners retain the administrative
      // override. The check runs INSIDE the transfer transaction (after the
      // subtree rows are locked) so content committed between any preflight and
      // the transfer cannot slip past the guard.
      let result: Awaited<ReturnType<typeof ctx.documentModel.transferTo>>;
      try {
        result = await ctx.documentModel.transferTo(
          input.documentId,
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
            message:
              "Only workspace owners can transfer a document tree containing others' content",
          });
        }
        throw error;
      }
      if (ctx.workspaceId) {
        const sourcePermissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all(
          result.documentIds.map((id) => sourcePermissionModel.removeAll('document', id)),
        );
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        const targetPermissionModel = new ResourcePermissionModel(
          ctx.serverDB,
          input.targetWorkspaceId,
        );
        await Promise.all(
          result.documentIds.map((id) =>
            targetPermissionModel.setAccessLevel(
              'document',
              id,
              input.targetAccessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.document,
              ctx.userId,
            ),
          ),
        );
      }
      return result;
    }),
  /**
   * Publish one private document into the workspace. Thin wrapper
   * around `setDocumentVisibility({ id, visibility: 'public' })`; kept for
   * backwards compatibility with existing callers.
   */
  publishDocumentToWorkspace: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ accessLevel: z.enum(['view', 'edit']).optional(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Same guard as the sibling `setDocumentVisibility` — publishing is a
      // visibility change and stays creator-only.
      if (ctx.workspaceId) {
        const doc = await ctx.documentModel.findById(input.id);
        if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

        await assertCanPerformResourceAction({
          action: 'changeVisibility',
          db: ctx.serverDB,
          grantedPermissions: (ctx as { workspacePermissionCodes?: string[] })
            .workspacePermissionCodes,
          meta: {
            userId: doc.userId,
            visibility: doc.visibility,
            workspaceId: doc.workspaceId,
          },
          resourceId: input.id,
          resourceType: 'document',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      const result = await ctx.documentService.publishToWorkspace(input.id);
      if (ctx.workspaceId) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        // A level staged on the permission page while the document was still
        // private must survive publishing — only fall back to the default
        // when neither an explicit input nor a staged row exists.
        const staged = await permissionModel.getAccessLevel('document', input.id);
        await permissionModel.setAccessLevel(
          'document',
          input.id,
          input.accessLevel ?? staged ?? DEFAULT_RESOURCE_ACCESS_LEVELS.document,
          ctx.userId,
        );
      }
      return result;
    }),
  /**
   * Toggle one document's workspace visibility. Documents do not inherit from
   * their parent, so children are deliberately left unchanged.
   */
  setDocumentVisibility: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        id: z.string(),
        accessLevel: z.enum(['view', 'edit']).optional(),
        visibility: z.enum(['private', 'public']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Document visibility only applies inside a workspace',
        });
      }

      const doc = await ctx.documentModel.findById(input.id);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      await assertCanPerformResourceAction({
        action: 'changeVisibility',
        db: ctx.serverDB,
        grantedPermissions: (ctx as { workspacePermissionCodes?: string[] })
          .workspacePermissionCodes,
        meta: {
          userId: doc.userId,
          visibility: doc.visibility,
          workspaceId: doc.workspaceId,
        },
        resourceId: input.id,
        resourceType: 'document',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
      if (doc.visibility === input.visibility) {
        const accessLevel =
          input.visibility === 'public'
            ? (input.accessLevel ??
              (await permissionModel.getEffectiveAccessLevel('document', input.id)))
            : 'edit';
        if (input.visibility === 'public' && input.accessLevel) {
          await permissionModel.setAccessLevel('document', input.id, input.accessLevel, ctx.userId);
        }
        return {
          ...buildResourcePermissionState({
            accessLevel,
            canManage: true,
            creatorId: doc.userId,
            visibility: input.visibility,
          }),
          documentIds: [input.id],
        };
      }

      const result = await ctx.documentService.setVisibility(input.id, input.visibility);
      // A level staged on the permission page while the document was still
      // private must survive publishing — only fall back to the default when
      // neither an explicit input nor a staged row exists.
      const staged =
        input.visibility === 'public'
          ? await permissionModel.getAccessLevel('document', input.id)
          : null;
      const accessLevel =
        input.visibility === 'private'
          ? 'edit'
          : (input.accessLevel ?? staged ?? DEFAULT_RESOURCE_ACCESS_LEVELS.document);
      if (input.visibility === 'private') {
        await permissionModel.removeAll('document', input.id);
      } else {
        await permissionModel.setAccessLevel('document', input.id, accessLevel, ctx.userId);
      }
      return {
        ...buildResourcePermissionState({
          accessLevel,
          canManage: true,
          creatorId: doc.userId,
          visibility: input.visibility,
        }),
        ...result,
      };
    }),
  copyDocumentToWorkspace: documentProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        documentId: z.string(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.documentModel.findById(input.documentId);
      if (!doc)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Document not found',
        });

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'DOCUMENT_CREATE',
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

      const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.documentId);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      return ctx.documentModel.copyToWorkspace(
        input.documentId,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),
};
