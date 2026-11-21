import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { FileService } from '@/server/services/file';
import { createSandboxService } from '@/server/services/sandbox';
import {
  type DriveCopyPurpose,
  DriveDownloadError,
  prepareDriveDownload,
} from '@/server/services/sandbox/driveDownload';

import { assertReadable, resolveDriveScope } from './driveScope';
import { instanceProcedure } from './procedures';
import { driveSchema, relativePathSchema } from './schemas';

/**
 * `DOWNLOAD_FAILED` is a 500, not the 502 a failed upstream would suggest:
 * the edge in front of the app replaces a 502's body with its own error page,
 * so the client could no longer read the code and said "unreadable response".
 */
const ERROR_CODES: Record<DriveDownloadError['code'], TRPCError['code']> = {
  DOWNLOAD_FAILED: 'INTERNAL_SERVER_ERROR',
  DOWNLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  DOWNLOAD_UNAVAILABLE: 'NOT_IMPLEMENTED',
  PATH_NOT_FOUND: 'NOT_FOUND',
  PREVIEW_NOT_A_FILE: 'BAD_REQUEST',
};

/**
 * The topic the download sessions run under. Not a topic of ours — it is never
 * looked up — but the execution plane keys a session to one, and binds that
 * session to the drive its first call names. One per drive, so downloading
 * from the public drive and then the personal one does not tear down and
 * restart the same sandbox each time.
 */
export const driveDownloadTopicId = (storageKey: string) => `sandbox-drive-download:${storageKey}`;

/**
 * Copies one path of the drive to object storage — through the storage
 * service, or a sandbox session where it cannot — and answers with a link to
 * it. Read the way a listing is — a member reaches whatever they can
 * browse — and a hidden environment directory is refused
 * when named and left out of any folder that holds it.
 *
 * A mutation, not a query: it writes an object to storage — and may start a
 * sandbox session to do it — so a refetch-on-focus must never repeat that.
 */
const copyProcedure = (purpose: DriveCopyPurpose) =>
  instanceProcedure
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
          purpose,
          sandbox,
          storage: scope.client,
        });
      } catch (error) {
        if (error instanceof DriveDownloadError) {
          throw new TRPCError({ cause: error, code: ERROR_CODES[error.code], message: error.code });
        }
        throw error;
      }
    });

export const downloadRouter = router({
  /** A link that downloads one file of the drive as it is, or one folder as a zip. */
  prepareDownload: copyProcedure('download'),

  /**
   * A link one file of the drive can be shown in the page from — answered
   * inline, with the type the file's name implies, so the viewer can render
   * it. A folder is refused; it has nothing to show but its listing.
   */
  preparePreview: copyProcedure('preview'),
});
