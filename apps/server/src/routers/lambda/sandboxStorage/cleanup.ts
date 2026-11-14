import debug from 'debug';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { forgetDriveFolders } from '@/server/services/sandbox';
import type {
  SandboxStorageAnalysis,
  SandboxStorageAnalysisResult,
} from '@/server/services/sandbox/storageFiles';

import {
  assertWritablePath,
  type DriveScope,
  holdsHidden,
  isHidden,
  resolveDriveScope,
} from './driveScope';
import { instanceProcedure, mapStorageError } from './procedures';
import { driveSchema, relativePathSchema, topicIdSchema } from './schemas';

const log = debug('lobe-server:sandbox:drive-cleanup');

/** One batch, matching the storage service's own ceiling. */
export const MAX_DELETE_PATHS = 100;

/**
 * The analysis as this member may see it. The figures stay whole — the drive's
 * total is what its quota is judged on, hidden folders included — but no path
 * inside a hidden folder is named, exactly as a listing leaves them out.
 */
export const visibleAnalysis = (
  analysis: SandboxStorageAnalysis,
  scope: Pick<DriveScope, 'hidden'>,
): SandboxStorageAnalysis => {
  if (!analysis.result || scope.hidden.length === 0) return analysis;

  // Neither a path inside a hidden folder, nor one holding it: the latter's
  // size would say how big the hidden one is, and deleting it is refused.
  const visible = (path: string) =>
    !isHidden(path, scope as DriveScope) && !holdsHidden(path, scope);
  const result: SandboxStorageAnalysisResult = {
    ...analysis.result,
    items: analysis.result.items.filter((item) => visible(item.path)),
    largestDirectories: analysis.result.largestDirectories.filter((entry) => visible(entry.path)),
    largestFiles: analysis.result.largestFiles.filter((entry) => visible(entry.path)),
  };

  return { ...analysis, result };
};

export const cleanupRouter = router({
  /**
   * One step of the drive's space analysis. A large drive takes several:
   * the client calls again while `status` is not `done`. Not quota gated —
   * this is how a drive over its limit is emptied.
   */
  analyzeStorage: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        restart: z.boolean().optional(),
        top: z.number().int().min(1).max(200).optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, ...input } }) => {
      const scope = await resolveDriveScope(ctx);
      const analysis = await scope.client.analyzeStorage(input).catch(mapStorageError);

      return visibleAnalysis(analysis, scope);
    }),

  /**
   * Delete several files or folders for good. The confirmation is the
   * client's to ask for; this layer only refuses what the member may not
   * touch: a hidden folder, or one that holds one.
   */
  deleteFiles: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        paths: z.array(relativePathSchema).min(1).max(MAX_DELETE_PATHS),
        regenerableOnly: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, ...input } }) => {
      const scope = await resolveDriveScope(ctx);
      for (const path of input.paths) assertWritablePath(path, scope);

      const paths = [...new Set(input.paths)];
      const result = await scope.client.deletePaths({ ...input, paths }).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);
      // Deleting cannot be undone, so each one leaves a line saying who and how much.
      log(
        'user %s deleted from %s: %d paths, regenerableOnly=%s, freed %d bytes, %d pending, %d failed',
        ctx.userId,
        ctx.claim.key,
        paths.length,
        !!input.regenerableOnly,
        result.freedBytes,
        result.pending.length,
        result.failed?.length ?? 0,
      );

      return result;
    }),
});
