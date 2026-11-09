import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { FileService } from '@/server/services/file';
import { createSandboxService } from '@/server/services/sandbox';
import {
  type DriveCopyPurpose,
  DriveDownloadError,
  driveDownloadFolder,
  prepareDriveDownload,
} from '@/server/services/sandbox/driveDownload';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';

import { assertReadable, isPublicDrive, resolveDriveScope } from './driveScope';
import { instanceProcedure, mapStorageError, type SandboxStorageClient } from './procedures';
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
 * Copies one path of the drive to object storage from a sandbox session and
 * answers with a link to it. Read the way a listing is — a member reaches
 * whatever they can browse — and a hidden environment directory is refused
 * when named and left out of any folder that holds it.
 *
 * A mutation, not a query: it starts a sandbox session and writes an object
 * to storage, and a refetch-on-focus must never repeat that.
 */
/**
 * Refuses a download whose folder is not on the drive, before a session is
 * started in it: the execution plane creates a missing working directory
 * (`mkdir -p` then `cd`), so a stale listing or a guessed name would leave an
 * empty folder at the public drive's root for every member to see.
 */
const assertFolderExists = async (client: SandboxStorageClient, folder: string) => {
  try {
    await client.listFiles({ path: folder });
  } catch (error) {
    if (error instanceof SandboxStorageFilesError && error.status === 404) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'PATH_NOT_FOUND' });
    }
    mapStorageError(error);
  }
};

const copyProcedure = (purpose: DriveCopyPurpose) =>
  instanceProcedure
    .input(z.object({ drive: driveSchema, path: relativePathSchema }))
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveDriveScope(ctx);
      assertReadable(input.path, scope);

      // The public drive is a shared storage, whose root the execution plane
      // will not run a drive session at; it is narrowed to the path's folder.
      const folder = isPublicDrive(ctx) ? driveDownloadFolder(input.path) : undefined;
      if (folder) await assertFolderExists(scope.client, folder);

      const sandbox = createSandboxService({
        marketService: ctx.marketService,
        sandboxCwd: folder,
        sandboxMode: 'drive',
        topicId: driveDownloadTopicId(ctx.claim.key),
        userId: ctx.userId,
      });

      try {
        return await prepareDriveDownload({
          fileService: new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
          folder,
          hidden: scope.hidden,
          path: input.path,
          purpose,
          sandbox,
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
