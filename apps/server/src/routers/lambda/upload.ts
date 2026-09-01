import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { FileS3 } from '@/server/modules/S3';

const multipartUploadSchema = z.object({
  pathname: z.string().min(1),
  uploadId: z.string().min(1),
});

const multipartPartSchema = z.object({
  etag: z.string().min(1),
  partNumber: z.number().int().min(1).max(10_000),
});

const uploadSizeSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE)
  .optional();

export const uploadRouter = router({
  abortS3MultipartUpload: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(multipartUploadSchema)
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      await s3.abortMultipartUpload(input.pathname, input.uploadId);
      return { success: true };
    }),

  completeS3MultipartUpload: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      multipartUploadSchema.extend({
        partCount: z.number().int().min(1).max(10_000),
        parts: z.array(multipartPartSchema).max(10_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      await s3.completeMultipartUpload(
        input.pathname,
        input.uploadId,
        input.partCount,
        input.parts?.map(({ etag, partNumber }) => ({ ETag: etag, PartNumber: partNumber })),
      );
      return { success: true };
    }),

  createS3MultipartUpload: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        contentType: z.string().optional(),
        pathname: z.string().min(1),
        size: uploadSizeSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const s3 = new FileS3();
      const uploadId = await s3.createMultipartUpload(input.pathname, input.contentType);

      return { uploadId };
    }),

  createS3MultipartUploadPartUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      multipartUploadSchema.extend({
        partNumber: z.number().int().min(1).max(10_000),
      }),
    )
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      return s3.createPreSignedUploadPartUrl(input.pathname, input.uploadId, input.partNumber);
    }),

  createS3PreSignedUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string(), size: uploadSizeSchema }))
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      return await s3.createPreSignedUrl(input.pathname);
    }),
});

export type FileRouter = typeof uploadRouter;
