import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { FileService } from '@/server/services/file';
import { createSandboxService } from '@/server/services/sandbox';
import { DriveDownloadError, prepareDriveDownload } from '@/server/services/sandbox/driveDownload';

import { assertReadable, resolveDriveScope } from './driveScope';
import { instanceProcedure } from './procedures';
import { driveSchema, relativePathSchema } from './schemas';

const ERROR_CODES: Record<DriveDownloadError['code'], TRPCError['code']> = {
  DOWNLOAD_FAILED: 'BAD_GATEWAY',
  DOWNLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  DOWNLOAD_UNAVAILABLE: 'NOT_IMPLEMENTED',
  PATH_NOT_FOUND: 'NOT_FOUND',
};

/**
 * The topic the download sessions run under. Not a topic of ours — it is never
 * looked up — but the execution plane keys a session to one, and binds that
 * session to the drive its first call names. One per drive, so downloading
 * from the public drive and then the personal one does not tear down and
 * restart the same sandbox each time.
 */
export const driveDownloadTopicId = (storageKey: string) => `sandbox-drive-download:${storageKey}`;

export const downloadRouter = router({
  /**
   * A link the browser can download one file or folder of the drive from: the
   * file as it is, a folder as a zip. Read the way a listing is — a member
   * downloads whatever they can browse — and a hidden environment directory
   * is refused when named and left out of any folder that holds it.
   *
   * A mutation, not a query: it starts a sandbox session and writes an object
   * to storage, and a refetch-on-focus must never repeat that.
   */
  prepareDownload: instanceProcedure
    .input(z.object({ drive: driveSchema, path: relativePathSchema }))
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveDriveScope(ctx);
      assertReadable(input.path, scope);

      const sandbox = createSandboxService({
        marketService: ctx.marketService,
        sandboxMode: 'drive',
        topicId: driveDownloadTopicId(ctx.claim.key),
        userId: ctx.userId,
      });

      try {
        return await prepareDriveDownload({
          fileService: new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
          hidden: scope.hidden,
          path: input.path,
          sandbox,
        });
      } catch (error) {
        if (error instanceof DriveDownloadError) {
          throw new TRPCError({ cause: error, code: ERROR_CODES[error.code], message: error.code });
        }
        throw error;
      }
    }),
});
