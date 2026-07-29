import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileTransferStorageCheck } from '@/business/server/lambda-routers/file';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { FREE_DOCUMENT_HISTORY_WINDOW_DAYS } from '@/const/documentHistory';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
  buildResourcePermissionState,
  getResourceMeta,
} from '@/server/services/resourcePermission';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from './_helpers/assertWorkspaceRowManageable';
import {
  compareDocumentHistoryItemsInputSchema,
  getDocumentHistoryItemInputSchema,
  listDocumentHistoryInputSchema,
  saveDocumentHistoryInputSchema,
  updateDocumentInputSchema,
} from './_schema/documentHistory';

/**
 * Creating a child modifies the parent's tree — viewers of a workspace-shared
 * parent must not be able to insert under it. Parents outside the current
 * workspace (personal docs, foreign ids) fall through; the model's ownership
 * WHERE keeps those unreachable anyway.
 */
const assertCanCreateUnderParent = async (
  ctx: {
    serverDB: Parameters<typeof getResourceMeta>[0];
    userId: string;
    workspaceId?: string | null;
  },
  parentId: string | undefined,
) => {
  if (!ctx.workspaceId || !parentId) return;
  const meta = await getResourceMeta(ctx.serverDB, 'document', parentId);
  if (!meta || meta.workspaceId !== ctx.workspaceId) return;
  await assertCanEditResource({
    db: ctx.serverDB,
    resourceId: parentId,
    resourceType: 'document',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

const getFreeDocumentHistorySince = () => {
  const now = Date.now();

  return new Date(now - FREE_DOCUMENT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
};

const documentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId, wsId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, wsId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId, wsId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const documentRouter = router({
  createDocument: documentProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        content: z.string().optional(),
        editorData: z.string().optional(),
        fileType: z.string().optional(),
        knowledgeBaseId: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
        parentId: z.string().optional(),
        slug: z.string().optional(),
        title: z.string(),
        // Workspace-only knob; ignored in personal mode by the model layer.
        // When omitted, user-authored workspace docs default to private.
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve parentId if it's a slug
      let resolvedParentId = input.parentId;
      if (input.parentId) {
        const docBySlug = await ctx.documentModel.findBySlug(input.parentId);
        if (docBySlug) {
          resolvedParentId = docBySlug.id;
        }
      }

      await assertCanCreateUnderParent(ctx, resolvedParentId);

      // Parse editorData from JSON string to object
      const editorData = input.editorData ? JSON.parse(input.editorData) : undefined;
      const document = await ctx.documentService.createDocument({
        ...input,
        editorData,
        parentId: resolvedParentId,
      });
      if (ctx.workspaceId && document.visibility !== 'private') {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'document',
          document.id,
          DEFAULT_RESOURCE_ACCESS_LEVELS.document,
          ctx.userId,
        );
      }
      return document;
    }),

  createDocuments: documentProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        documents: z.array(
          z.object({
            content: z.string().optional(),
            editorData: z.string(),
            fileType: z.string().optional(),
            knowledgeBaseId: z.string().optional(),
            metadata: z.record(z.string(), z.any()).optional(),
            parentId: z.string().optional(),
            slug: z.string().optional(),
            title: z.string(),
            visibility: z.enum(['private', 'public']).optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Process each document: resolve parentId and parse editorData
      const processedDocuments = await Promise.all(
        input.documents.map(async (doc) => {
          // Resolve parentId if it's a slug
          let resolvedParentId = doc.parentId;
          if (doc.parentId) {
            const docBySlug = await ctx.documentModel.findBySlug(doc.parentId);
            if (docBySlug) {
              resolvedParentId = docBySlug.id;
            }
          }

          // Parse editorData from JSON string to object
          const editorData = JSON.parse(doc.editorData);

          return {
            ...doc,
            editorData,
            parentId: resolvedParentId,
          };
        }),
      );

      // Same parent-edit guard as `createDocument`, deduped across the batch.
      const parentIds = [
        ...new Set(processedDocuments.map((doc) => doc.parentId).filter(Boolean)),
      ] as string[];
      for (const parentId of parentIds) {
        await assertCanCreateUnderParent(ctx, parentId);
      }

      const createdDocuments = await ctx.documentService.createDocuments(processedDocuments);
      if (ctx.workspaceId) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all(
          createdDocuments
            .filter((document) => document.visibility !== 'private')
            .map((document) =>
              permissionModel.setAccessLevel(
                'document',
                document.id,
                DEFAULT_RESOURCE_ACCESS_LEVELS.document,
                ctx.userId,
              ),
            ),
        );
      }
      return createdDocuments;
    }),

  deleteDocument: documentProcedure
    .use(withScopedPermission('document:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'delete',
          db: ctx.serverDB,
          resourceId: input.id,
          resourceType: 'document',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      // Non-owner members may delete their own folder, but the recursive
      // cascade must not take other members' descendants with it.
      const result = await ctx.documentService.deleteDocument(input.id, {
        restrictToCreator: isWorkspaceNonOwner(ctx),
      });
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'document',
          input.id,
        );
      }
      return result;
    }),

  deleteDocuments: documentProcedure
    .use(withScopedPermission('document:delete'))
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.workspaceId) {
        await Promise.all(
          input.ids.map((id) =>
            assertCanPerformResourceAction({
              action: 'delete',
              db: ctx.serverDB,
              resourceId: id,
              resourceType: 'document',
              userId: ctx.userId,
              workspaceId: ctx.workspaceId!,
            }),
          ),
        );
      }
      const result = await ctx.documentService.deleteDocuments(input.ids, {
        restrictToCreator: isWorkspaceNonOwner(ctx),
      });
      if (ctx.workspaceId) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all(input.ids.map((id) => permissionModel.removeAll('document', id)));
      }
      return result;
    }),

  getDocumentById: documentProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.documentService.getDocumentById(input.id);
      // `source` is a storage key for file-backed documents; sign it so PDF viewers
      // and downloads receive a usable URL. Absolute URLs (web sources) pass through.
      if (!doc?.source || /^https?:\/\//i.test(doc.source)) return doc;
      const fileService = new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      return {
        ...doc,
        source: await fileService.getFileAccessUrl({
          fileId: doc.fileId ?? undefined,
          id: doc.id,
          url: doc.source,
        }),
      };
    }),

  listDocumentHistory: documentProcedure
    .input(listDocumentHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.documentService.listDocumentHistory(
        {
          ...input,
          beforeSavedAt: input.beforeSavedAt ? new Date(input.beforeSavedAt) : undefined,
        },
        {
          historySince: getFreeDocumentHistorySince(),
        },
      );
    }),

  getDocumentHistoryItem: documentProcedure
    .input(getDocumentHistoryItemInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.documentService.getDocumentHistoryItem(input, {
        historySince: getFreeDocumentHistorySince(),
      });
    }),

  compareDocumentHistoryItems: documentProcedure
    .input(compareDocumentHistoryItemsInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.documentService.compareDocumentHistoryItems(input, {
        historySince: getFreeDocumentHistorySince(),
      });
    }),

  saveDocumentHistory: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(saveDocumentHistoryInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Same write guard as `updateDocument` — history saves rewrite the
      // document's editorData, so a view-level member must not reach it.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.documentId,
        resourceType: 'document',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      const editorData = JSON.parse(input.editorData);
      return ctx.documentService.saveDocumentHistory(
        input.documentId,
        editorData,
        input.saveSource,
        input.lockOwnerId,
      );
    }),

  getFolderBreadcrumb: documentProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const chain = [];
      let currentFolder = await ctx.documentModel.findBySlug(input.slug);

      // Build chain from current folder to root
      while (currentFolder) {
        chain.unshift({
          id: currentFolder.id,
          name: currentFolder.title || currentFolder.filename || 'Untitled',
          slug: currentFolder.slug || currentFolder.id,
        });

        // Find parent folder
        if (currentFolder.parentId) {
          currentFolder = await ctx.documentModel.findById(currentFolder.parentId);
        } else {
          break;
        }
      }

      return chain;
    }),

  parseDocument: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lobeDocument = await ctx.documentService.parseDocument(input.id);

      return lobeDocument;
    }),

  parseFileContent: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        id: z.string(),
        skipExist: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lobeDocument = await ctx.documentService.parseFile(input.id);

      return lobeDocument;
    }),

  queryDocuments: documentProcedure
    .input(
      z
        .object({
          current: z.number().optional(),
          fileTypes: z.array(z.string()).optional(),
          pageSize: z.number().max(100).optional(),
          sourceTypes: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.documentService.queryDocuments(input);
    }),

  acquireDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string(), ownerId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // The lock grants exclusive write access — a view-level member must not
      // be able to seize it and starve legitimate editors.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.id,
        resourceType: 'document',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return input.ownerId
        ? ctx.documentService.acquireDocumentLockWithOwner(input.id, input.ownerId)
        : ctx.documentService.acquireDocumentLock(input.id);
    }),

  getDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string(), ownerId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.documentService.getDocumentLock(input.id, input.ownerId);
    }),

  releaseDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string(), ownerId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.ownerId)
        await ctx.documentService.releaseDocumentLockWithOwner(input.id, input.ownerId);
      else await ctx.documentService.releaseDocumentLock(input.id);
    }),

  updateDocument: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(updateDocumentInputSchema)
    .mutation(async ({ ctx, input }) => {
      // General-access write guard: a public document whose workspace level
      // is `viewer` is read-only for everyone but the creator / owner.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.id,
        resourceType: 'document',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // A move mutates both the source and destination trees as well as the
      // document. Only check when the parent really changes: several editor
      // paths include the current parentId in ordinary metadata/autosave
      // updates. `null` is an explicit detach and still leaves the source.
      if (input.parentId !== undefined) {
        const currentDocument = await ctx.documentModel.findById(input.id);
        const currentParentId = currentDocument?.parentId ?? null;
        const nextParentId = input.parentId ?? null;
        if (currentParentId !== nextParentId) {
          if (currentParentId) await assertCanCreateUnderParent(ctx, currentParentId);
          if (nextParentId) await assertCanCreateUnderParent(ctx, nextParentId);
        }
      }

      const { id, editorData: editorDataString, ...params } = input;
      // Parse editorData from JSON string to object if present
      const editorData = editorDataString ? JSON.parse(editorDataString) : undefined;
      const result = await ctx.documentService.updateDocument(id, {
        ...params,
        editorData,
      });

      return result;
    }),

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

      // The transfer rehomes every descendant document and anchored file. A
      // non-owner member may transfer their own root only when the entire
      // subtree is theirs; workspace owners retain the administrative override.
      if (
        isWorkspaceNonOwner(ctx) &&
        (await ctx.documentModel.subtreeHasForeignRows(input.documentId))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only workspace owners can transfer a document tree containing others' content",
        });
      }

      const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.documentId);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      const result = await ctx.documentModel.transferTo(
        input.documentId,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
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
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'document',
          input.id,
          input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.document,
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
      const accessLevel =
        input.visibility === 'private'
          ? 'edit'
          : (input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.document);
      if (input.visibility === 'private') {
        await permissionModel.removeAll('document', input.id);
      } else {
        await permissionModel.setAccessLevel(
          'document',
          input.id,
          input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.document,
          ctx.userId,
        );
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
});
