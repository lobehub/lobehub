import { files } from '@lobechat/database/schemas';
import type { FileAccessScope } from '@lobechat/types';
import { and, inArray } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';
import { fileMatchesAccessScope } from '@/database/utils/fileVisibility';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import type { FileService } from '@/server/services/file';

/**
 * Normalize the reference-image URLs an agent passes to image generation.
 *
 * Models copy these URLs out of the injected `<files_info>` context, and long
 * presigned query strings get mistranscribed: one dropped character in
 * `X-Amz-Credential` or `X-Amz-Signature` makes SigV4 validation fail and the
 * provider downloads an S3 error XML instead of the image (op-trace evidence:
 * the context URL carried a 32-char access key while the tool-call argument
 * carried a 31-char copy of it, T-545). URLs also expire while a turn is
 * still running.
 *
 * For URLs pointing at this deployment's own storage the query string carries
 * no identity — the object is fully addressed by its key. So:
 *
 *   1. extract the storage key from the URL pathname (`getKeyFromFullUrl`);
 *   2. confirm the key belongs to an uploaded file the caller can access
 *      (`files.url` match scoped by `buildWorkspaceWhere` AND the caller's
 *      `fileAccessScope`) — never re-sign a key that no file record vouches
 *      for, or access control would widen from "URL holder" to "any key
 *      guesser". The scope matters when the caller is an agent-share visitor
 *      run executing under the shared agent's creator: without it, a
 *      visitor-controlled `/f/{id}` URL could resolve a private file owned by
 *      the creator and receive a fresh valid signature, bypassing the
 *      `metadata.agentShare` boundary enforced everywhere else;
 *   3. re-sign the verified key into a fresh presigned URL.
 *
 * Unrecognized URLs (external CDN, proxy `/f/{id}` form is resolved by
 * `getKeyFromFullUrl` through the files table) are returned unchanged.
 */
export const resignOwnStorageReferenceUrls = async (
  urls: string[],
  ctx: {
    db: LobeChatDatabase;
    fileAccessScope?: FileAccessScope;
    fileService: Pick<FileService, 'createPreSignedUrlForPreview' | 'getKeyFromFullUrl'>;
    userId: string;
    workspaceId?: string;
  },
): Promise<string[]> => {
  if (urls.length === 0) return urls;

  const keysForIndex = await Promise.all(
    urls.map(async (url) => {
      if (typeof url !== 'string' || !url) return undefined;
      try {
        return await ctx.fileService.getKeyFromFullUrl(url);
      } catch {
        return undefined;
      }
    }),
  );

  // Only URLs that resolved to a storage key are candidates for re-signing.
  const candidateIndexes: number[] = [];
  const candidateKeys: string[] = [];
  keysForIndex.forEach((key, index) => {
    if (key) {
      candidateIndexes.push(index);
      candidateKeys.push(key);
    }
  });
  if (candidateIndexes.length === 0) return urls;

  // Access control: re-sign only keys that map to a file record visible to
  // the caller under BOTH the workspace/ownership predicate and the run's
  // file access scope (an agent-share visitor run may only re-sign files it
  // uploaded through that share). Same-key rows from repeated uploads are
  // equivalent.
  const rows = await ctx.db
    .select({ url: files.url })
    .from(files)
    .where(
      and(
        buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, files),
        fileMatchesAccessScope(files.metadata, ctx.fileAccessScope ?? { type: 'ordinary' }),
        inArray(files.url, candidateKeys),
      ),
    );
  const resolvableKeys = new Set(rows.map((row) => row.url));

  return Promise.all(
    urls.map(async (url, index) => {
      const key = keysForIndex[index];
      if (!key || !resolvableKeys.has(key)) return url;
      try {
        return await ctx.fileService.createPreSignedUrlForPreview(key);
      } catch {
        // Signing is best-effort; keep the caller's URL on failure.
        return url;
      }
    }),
  );
};
