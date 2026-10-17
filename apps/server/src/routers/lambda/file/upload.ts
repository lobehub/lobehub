import { randomUUID } from 'node:crypto';

import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import isEqual from 'fast-deep-equal';
import { z } from 'zod';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import { checkFileStorageUsage } from '@/business/server/trpc-middlewares/lambda';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import type { FileService } from '@/server/services/file';
import { downloadRemoteImage } from '@/server/services/file/downloadRemoteImage';
import {
  FileSource,
  stripAgentShareFileProvenance,
  toFileSource,
  UploadFileSchema,
} from '@/types/files';

import { fileProcedure, resolveAccessibleParentDocument } from './procedures';

const isStoredObjectAvailable = async (fileService: FileService, url: string): Promise<boolean> => {
  try {
    // Hash records can outlive their backing object, for example when generated
    // assets are cleaned up but the global hash row remains. Treat stale rows as
    // missing so the client uploads a fresh copy instead of reusing a dead key.
    await fileService.getFileMetadata(url);
    return true;
  } catch (error) {
    console.error('Failed to verify existing file hash storage object:', error);
    return false;
  }
};

export const uploadProcedures = {
  checkFileHash: fileProcedure
    .use(withScopedPermission('file:upload'))
    .use(checkFileStorageUsage)
    .input(z.object({ hash: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existingFile = await ctx.fileModel.checkHash(input.hash);
      const existingHashUrl = existingFile?.isExist ? existingFile.url : undefined;
      if (!existingHashUrl) return existingFile;

      const isStorageAvailable = await isStoredObjectAvailable(ctx.fileService, existingHashUrl);

      return isStorageAvailable ? existingFile : { isExist: false };
    }),
  createFile: fileProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      UploadFileSchema.omit({ url: true }).extend({
        parentId: z.string().optional(),
        url: z.string(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const metadata = stripAgentShareFileProvenance(input.metadata);
      const existingFile = await ctx.fileModel.checkHash(input.hash!);
      const { isExist } = existingFile;
      const latestUpload = await ctx.fileUploadService.findLatest(input.url);
      if (!latestUpload && (await ctx.fileUploadService.hasAnyLiveSession(input.url))) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Upload pathname belongs to another session',
        });
      }

      const parentDocument = input.parentId
        ? await resolveAccessibleParentDocument(ctx, input.parentId)
        : undefined;
      const resolvedParentId = parentDocument?.id;
      const parentVisibility = parentDocument?.visibility;

      let knowledgeBaseVisibility: 'private' | 'public' | undefined;
      if (ctx.workspaceId && input.knowledgeBaseId) {
        const knowledgeBase = await ctx.knowledgeBaseModel.findById(input.knowledgeBaseId);
        if (!knowledgeBase) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Knowledge base not found' });
        }
        knowledgeBaseVisibility = knowledgeBase.visibility;
      }

      // Visibility precedence (workspace mode only — personal mode ignores the
      // column entirely):
      //   1. A library upload always uses the knowledge base visibility.
      //   2. Otherwise an explicit caller value wins.
      //   3. Otherwise inherit the parent document's visibility so a file
      //      uploaded inside a private folder stays private.
      //   4. Agent-document uploads default to 'public' to match their document's
      //      access contract; their source keeps them out of resource listings.
      //   5. Otherwise default top-level uploads to 'private' so new content
      //      starts in the creator's private space (mirrors the Pages spec).
      const resolvedVisibility: 'private' | 'public' | undefined = ctx.workspaceId
        ? (knowledgeBaseVisibility ??
          input.visibility ??
          parentVisibility ??
          (input.source === FileSource.AgentDocument ? 'public' : 'private'))
        : undefined;

      if (latestUpload?.status === 'settled') {
        const settledFile = latestUpload.fileId
          ? await ctx.fileModel.findById(latestUpload.fileId)
          : undefined;
        const isRetry =
          !!settledFile &&
          !input.knowledgeBaseId &&
          isExist &&
          existingFile.url === input.url &&
          settledFile.fileHash === input.hash &&
          settledFile.fileType === input.fileType &&
          settledFile.name === input.name &&
          settledFile.parentId === (resolvedParentId ?? null) &&
          settledFile.size === input.size &&
          (settledFile.source ?? undefined) === toFileSource(input.source) &&
          settledFile.url === input.url &&
          (!ctx.workspaceId || settledFile.visibility === resolvedVisibility) &&
          isEqual(settledFile.metadata, metadata ?? null);

        if (isRetry) {
          return {
            id: settledFile.id,
            url: await ctx.fileService.getFileAccessUrl(settledFile),
          };
        }

        // The same global object can be referenced by multiple logical files.
        // A non-identical request is the normal dedup path, not a stale retry.
      } else if (latestUpload && latestUpload.status !== 'active') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Upload session is no longer active' });
      }

      const activeUpload =
        latestUpload?.status === 'active'
          ? await ctx.fileUploadService.touchActive(input.url)
          : undefined;
      if (latestUpload?.status === 'active' && !activeUpload) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Upload session is no longer active' });
      }

      let actualSize: number;
      if (activeUpload) {
        try {
          const { contentLength } = await ctx.fileService.getFileMetadata(input.url);
          actualSize = contentLength;
        } catch {
          await ctx.fileUploadService.releaseBestEffort(input.url);
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uploaded file is unavailable' });
        }

        if (input.size !== activeUpload.size || actualSize !== activeUpload.size) {
          await ctx.fileUploadService.releaseBestEffort(input.url);
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uploaded file size mismatch' });
        }
      } else {
        actualSize = input.size;
        try {
          const { contentLength } = await ctx.fileService.getFileMetadata(input.url);
          if (contentLength >= 1) actualSize = contentLength;
        } catch {
          // Compatibility path for clients that uploaded before reservations were introduced.
        }
      }

      if (actualSize < 0) {
        await businessFileUploadCheck({
          actualSize,
          clientIp: ctx.clientIp ?? undefined,
          inputSize: input.size,
          url: input.url,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File size cannot be negative' });
      }

      if (actualSize > MAX_UPLOAD_FILE_SIZE) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE,
        });
      }

      const { id } = await ctx.serverDB.transaction(async (trx) => {
        let shouldRefreshGlobalFile = false;
        if (isExist && existingFile.url && existingFile.url !== input.url) {
          shouldRefreshGlobalFile = !(await isStoredObjectAvailable(
            ctx.fileService,
            existingFile.url,
          ));
        }

        if (shouldRefreshGlobalFile) {
          // A user may re-upload the same bytes after the old object key was
          // removed. Keep the global hash pointer on the newly uploaded object so
          // future dedup checks do not resolve back to the stale key.
          await ctx.fileModel.updateGlobalFile(
            input.hash!,
            {
              metadata,
              url: input.url,
            },
            trx,
          );
        }

        const createFile = () =>
          ctx.fileModel.create(
            {
              fileHash: input.hash,
              fileType: input.fileType,
              knowledgeBaseId: input.knowledgeBaseId,
              metadata,
              name: input.name,
              parentId: resolvedParentId,
              size: actualSize,
              // Attribution the caller supplied (e.g. a page-editor paste). The
              // wire type is a loose string for older clients, so unknown values
              // are dropped rather than persisted — `source` drives the resource
              // library's origin filter and its hidden-source exclusion.
              source: toFileSource(input.source),
              url: input.url,
              ...(resolvedVisibility ? { visibility: resolvedVisibility } : {}),
            },
            // if the file is not exist in global file, create a new one
            !isExist,
            trx,
          );

        if (activeUpload) {
          const lockedUpload = await ctx.fileUploadService.model.findLatestByPathnameForUpdate(
            input.url,
            trx,
          );
          if (lockedUpload?.id !== activeUpload.id || lockedUpload.status !== 'active') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Upload session is no longer active',
            });
          }

          const file = await createFile();
          const settled = await ctx.fileUploadService.model.settle(lockedUpload.id, file.id, trx);
          if (!settled) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Upload could not be settled' });
          }
          return file;
        }

        await businessFileUploadCheck({
          actualSize,
          clientIp: ctx.clientIp ?? undefined,
          inputSize: input.size,
          transaction: trx,
          url: input.url,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        return createFile();
      });

      return { id, url: await ctx.fileService.getFileAccessUrl({ id, url: input.url }) };
    }),
  rehostImage: fileProcedure
    .use(withScopedPermission('file:upload'))
    .use(checkFileStorageUsage)
    .input(z.object({ url: z.url() }))
    .mutation(async ({ ctx, input }) => {
      const { buffer, extension, mimeType } = await downloadRemoteImage(input.url);
      const pathname = `images/${ctx.userId}/${randomUUID()}.${extension}`;
      const result = await ctx.fileService.uploadFromBuffer(
        buffer,
        mimeType,
        pathname,
        (transaction) =>
          businessFileUploadCheck({
            actualSize: buffer.length,
            clientIp: ctx.clientIp ?? undefined,
            inputSize: buffer.length,
            transaction,
            url: pathname,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          }),
        { source: FileSource.PageEditor, visibility: 'private' },
      );
      return { fileId: result.fileId, url: result.url };
    }),
};
