import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { fileEnv } from '@/envs/file';
import { FileS3 } from '@/server/modules/S3';

// Supported file types for upload
const SUPPORTED_FILE_TYPES = {
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/webm'],
  document: [
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
};

const ALL_SUPPORTED_TYPES = Object.values(SUPPORTED_FILE_TYPES).flat();

// File size limits (in bytes)
const FILE_SIZE_LIMITS = {
  audio: 100 * 1024 * 1024, // 100MB
  document: 100 * 1024 * 1024, // 100MB
  image: 50 * 1024 * 1024, // 50MB
  video: 500 * 1024 * 1024, // 500MB
};

const getFileCategory = (mimeType: string): keyof typeof FILE_SIZE_LIMITS | null => {
  for (const [category, types] of Object.entries(SUPPORTED_FILE_TYPES)) {
    if (types.includes(mimeType)) {
      return category as keyof typeof FILE_SIZE_LIMITS;
    }
  }
  return null;
};

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .input(
      z.object({
        contentType: z.string().optional(),
        fileSize: z.number().optional(),
        pathname: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      const { pathname, contentType = 'application/octet-stream', fileSize } = input;

      // Validate content type if provided
      if (contentType && !ALL_SUPPORTED_TYPES.includes(contentType)) {
        throw new Error(
          `Unsupported file type: ${contentType}. Supported types: images, videos, audio, and documents.`,
        );
      }

      // Validate file size if provided
      if (fileSize) {
        const category = getFileCategory(contentType);
        if (category) {
          const limit = FILE_SIZE_LIMITS[category];
          if (fileSize > limit) {
            throw new Error(
              `File size exceeds limit. Maximum ${category} size is ${limit / (1024 * 1024)}MB.`,
            );
          }
        }
      }

      try {
        return await s3.createPreSignedUrl(pathname, contentType);
      } catch (error) {
        console.error('[Upload] Failed to create presigned URL:', error);
        throw new Error('Failed to generate upload URL. Please check S3 configuration.');
      }
    }),

  // Diagnostic endpoint to test S3 connectivity
  testS3Connection: publicProcedure.query(async () => {
    const checks = {
      hasAccessKey: !!fileEnv.S3_ACCESS_KEY_ID,
      hasBucket: !!fileEnv.S3_BUCKET,
      hasEndpoint: !!fileEnv.S3_ENDPOINT,
      hasSecretKey: !!fileEnv.S3_SECRET_ACCESS_KEY,
      isConfigComplete: !!(
        fileEnv.S3_ACCESS_KEY_ID &&
        fileEnv.S3_SECRET_ACCESS_KEY &&
        fileEnv.S3_BUCKET &&
        fileEnv.S3_ENDPOINT
      ),
    };

    if (!checks.isConfigComplete) {
      return {
        checks,
        error: 'S3 configuration is incomplete. Please check your environment variables.',
        success: false,
      };
    }

    try {
      const s3 = new FileS3();
      // Try to generate a test presigned URL
      const testUrl = await s3.createPreSignedUrl('test-connection.txt', 'text/plain');
      return {
        checks,
        success: true,
        testUrl: testUrl ? 'Generated successfully' : 'Failed to generate',
      };
    } catch (error) {
      return {
        checks,
        error: (error as Error)?.message || 'Unknown error',
        success: false,
      };
    }
  }),
});

export type FileRouter = typeof uploadRouter;
