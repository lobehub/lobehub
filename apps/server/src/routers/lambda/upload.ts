import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import type { FileUploadItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import type { FileUploadModel } from '@/database/models/fileUpload';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileS3 } from '@/server/modules/S3';
import { FILE_UPLOAD_SESSION_TTL, FileUploadService } from '@/server/services/fileUpload';

const MAX_MULTIPART_PARTS = 10_000;
const MULTIPART_PART_SIZE = 32 * 1024 * 1024;

const multipartUploadSchema = z.object({
  pathname: z.string().min(1),
  uploadId: z.string().min(1),
});

const multipartPartSchema = z.object({
  etag: z.string().min(1),
  partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
});

const uploadSizeSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE)
  .optional();

const uploadProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileUploadService: new FileUploadService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

const uploadConflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

const matchesReservation = (
  upload: FileUploadItem | undefined,
  params: { multipartPartSize?: number; size: number },
) =>
  upload?.size === params.size && upload.multipartPartSize === (params.multipartPartSize ?? null);

const isMissingObject = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const value = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return value.name === 'NotFound' || value.$metadata?.httpStatusCode === 404;
};

const reserveUpload = async (params: {
  clientIp?: string;
  db: LobeChatDatabase;
  model: FileUploadModel;
  multipartPartSize?: number;
  pathname: string;
  size: number;
  storage: Pick<FileS3, 'getFileMetadata'>;
  userId: string;
  workspaceId?: string | null;
}): Promise<FileUploadItem> => {
  const expiresAt = new Date(Date.now() + FILE_UPLOAD_SESSION_TTL);

  return params.db.transaction(async (transaction: Transaction) => {
    const existing = await params.model.findActiveByPathname(params.pathname, transaction);
    if (existing) {
      if (!matchesReservation(existing, params)) {
        throw uploadConflict('Upload pathname is already reserved');
      }

      return (await params.model.touchActive(params.pathname, expiresAt, transaction))!;
    }

    // A reservation authorizes deleting its own pathname on abort, so it must never be
    // granted over an object that already exists and therefore belongs to someone else.
    const objectExists = await params.storage
      .getFileMetadata(params.pathname)
      .then(() => true)
      .catch((error: unknown) => {
        if (isMissingObject(error)) return false;
        throw error;
      });
    if (objectExists) throw uploadConflict('Upload pathname is already in use');

    try {
      await businessFileUploadCheck({
        actualSize: params.size,
        clientIp: params.clientIp,
        inputSize: params.size,
        transaction,
        url: params.pathname,
        userId: params.userId,
        workspaceId: params.workspaceId,
      });
    } catch (error) {
      const concurrent = await params.model.findActiveByPathname(params.pathname, transaction);
      if (matchesReservation(concurrent, params)) return concurrent!;
      throw error;
    }

    const created = await params.model.create(
      {
        expiresAt,
        multipartPartSize: params.multipartPartSize,
        pathname: params.pathname,
        size: params.size,
      },
      transaction,
    );
    if (created) return created;

    const concurrent = await params.model.findActiveByPathname(params.pathname, transaction);
    if (matchesReservation(concurrent, params)) return concurrent!;

    throw uploadConflict('Upload pathname is already reserved');
  });
};

const getMultipartPartSize = (size: number) =>
  Math.max(MULTIPART_PART_SIZE, Math.ceil(size / MAX_MULTIPART_PARTS));

const getActiveSession = async (
  service: FileUploadService,
  pathname: string,
): Promise<FileUploadItem | undefined> => service.assertActiveOrLegacy(pathname);

const validateMultipartSession = (upload: FileUploadItem, input: { uploadId: string }): number => {
  if (upload.multipartUploadId !== input.uploadId || !upload.multipartPartSize) {
    throw uploadConflict('Multipart upload does not match the active session');
  }

  return upload.multipartPartSize;
};

const isMissingMultipartUpload = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const value = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return value.name === 'NoSuchUpload' || value.$metadata?.httpStatusCode === 404;
};

export const uploadRouter = router({
  abortS3MultipartUpload: uploadProcedure
    .use(withScopedPermission('file:upload'))
    .input(multipartUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.fileUploadService.findLatest(input.pathname);

      if (!upload) {
        if (await ctx.fileUploadService.hasAnyLiveSession(input.pathname)) {
          throw uploadConflict('Upload pathname belongs to another session');
        }
        const s3 = new FileS3();
        await s3.abortMultipartUpload(input.pathname, input.uploadId);
        return { success: true };
      }
      if (upload.multipartUploadId !== input.uploadId) {
        throw uploadConflict('Multipart upload does not match the upload session');
      }
      if (upload.status === 'settled') {
        throw uploadConflict('A settled upload cannot be aborted');
      }
      if (upload.status !== 'active') return { success: true };

      await ctx.fileUploadService.release(input.pathname);
      return { success: true };
    }),

  abortS3Upload: uploadProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.fileUploadService.findLatest(input.pathname);
      if (!upload || upload.status === 'released' || upload.status === 'expired') {
        return { success: true };
      }
      if (upload.status === 'settled') return { success: true };
      if (upload.status === 'active') await ctx.fileUploadService.release(input.pathname);

      return { success: true };
    }),

  completeS3MultipartUpload: uploadProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      multipartUploadSchema.extend({
        partCount: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
        parts: z.array(multipartPartSchema).max(MAX_MULTIPART_PARTS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s3 = new FileS3();
      const upload = await getActiveSession(ctx.fileUploadService, input.pathname);

      if (!upload) {
        await s3.completeMultipartUpload(
          input.pathname,
          input.uploadId,
          input.partCount,
          input.parts?.map(({ etag, partNumber }) => ({ ETag: etag, PartNumber: partNumber })),
        );
        return { success: true };
      }

      const partSize = validateMultipartSession(upload, input);
      const expectedPartCount = Math.ceil(upload.size / partSize);
      if (input.partCount !== expectedPartCount) {
        throw uploadConflict('Multipart part count does not match the upload session');
      }

      try {
        await s3.completeMultipartUpload(
          input.pathname,
          input.uploadId,
          expectedPartCount,
          undefined,
          { partSize, size: upload.size },
        );
      } catch (error) {
        if (!isMissingMultipartUpload(error)) throw error;

        const { contentLength } = await s3.getFileMetadata(input.pathname);
        if (contentLength !== upload.size) throw error;
      }

      await ctx.fileUploadService.model.markCompleted(upload.id);
      return { success: true };
    }),

  createS3MultipartUpload: uploadProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        contentType: z.string().optional(),
        pathname: z.string().min(1),
        size: uploadSizeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s3 = new FileS3();
      if (input.size === undefined) {
        const uploadId = await s3.createMultipartUpload(input.pathname, input.contentType);
        return { uploadId };
      }

      const partSize = getMultipartPartSize(input.size);
      const upload = await reserveUpload({
        clientIp: ctx.clientIp ?? undefined,
        db: ctx.serverDB,
        model: ctx.fileUploadService.model,
        multipartPartSize: partSize,
        pathname: input.pathname,
        size: input.size,
        storage: s3,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (upload.multipartUploadId) return { partSize, uploadId: upload.multipartUploadId };

      let uploadId: string;
      try {
        uploadId = await s3.createMultipartUpload(input.pathname, input.contentType);
      } catch (error) {
        await ctx.fileUploadService.releaseBestEffort(input.pathname);
        throw error;
      }

      const attached = await ctx.fileUploadService.model.attachMultipartUpload(upload.id, uploadId);
      if (attached) return { partSize, uploadId };

      await s3.abortMultipartUpload(input.pathname, uploadId);
      const concurrent = await ctx.fileUploadService.model.findActiveByPathname(input.pathname);
      if (concurrent?.multipartUploadId) {
        return { partSize: concurrent.multipartPartSize!, uploadId: concurrent.multipartUploadId };
      }

      throw uploadConflict('Upload session is no longer active');
    }),

  createS3MultipartUploadPartUrl: uploadProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      multipartUploadSchema.extend({
        partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s3 = new FileS3();
      const upload = await getActiveSession(ctx.fileUploadService, input.pathname);
      if (!upload) {
        return s3.createPreSignedUploadPartUrl(input.pathname, input.uploadId, input.partNumber);
      }

      const partSize = validateMultipartSession(upload, input);
      const partCount = Math.ceil(upload.size / partSize);
      if (input.partNumber > partCount) {
        throw uploadConflict('Multipart part number does not match the upload session');
      }

      const contentLength =
        input.partNumber === partCount ? upload.size - (partCount - 1) * partSize : partSize;

      return s3.createPreSignedUploadPartUrl(
        input.pathname,
        input.uploadId,
        input.partNumber,
        contentLength,
      );
    }),

  createS3PreSignedUrl: uploadProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string().min(1), size: uploadSizeSchema }))
    .mutation(async ({ ctx, input }) => {
      const s3 = new FileS3();
      if (input.size === undefined) return s3.createPreSignedUrl(input.pathname);

      await reserveUpload({
        clientIp: ctx.clientIp ?? undefined,
        db: ctx.serverDB,
        model: ctx.fileUploadService.model,
        pathname: input.pathname,
        size: input.size,
        storage: s3,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      try {
        return await s3.createPreSignedUrl(input.pathname, input.size);
      } catch (error) {
        await ctx.fileUploadService.releaseBestEffort(input.pathname);
        throw error;
      }
    }),
});

export type FileRouter = typeof uploadRouter;
