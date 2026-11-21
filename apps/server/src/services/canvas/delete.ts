import { TRPCError } from '@trpc/server';

import { unpublishCanvasSite } from '@/business/server/canvasPublish';
import { CanvasFileModel } from '@/database/models/canvasFile';
import type { WorkModel } from '@/database/models/work';
import { CanvasFileRepository } from '@/database/repositories/canvasFile';
import type { LobeChatDatabase } from '@/database/type';

import type { CanvasStorageService } from './storage';

export interface DeleteCanvasOptions {
  /**
   * Free only files left without a Work. A canvas that has a Work (for
   * instance one whose files were committed a moment before its Work was
   * registered) is skipped rather than deleted.
   */
  orphanOnly?: boolean;
}

/**
 * Delete one of the caller's canvases outright: its public site, its Work
 * (with every version) and every file it registered, which is what frees its
 * storage usage. A canvas whose Work is already gone still has its files
 * removed. Returns whether anything was deleted (an orphan-only call skips
 * live canvases).
 */
export const deleteCanvas = async (
  canvasId: string,
  deps: {
    db: LobeChatDatabase;
    storage: CanvasStorageService;
    userId: string;
    workModel: WorkModel;
    workspaceId?: string;
  },
  { orphanOnly }: DeleteCanvasOptions = {},
): Promise<{ deleted: boolean }> => {
  const { db, storage, userId, workModel, workspaceId } = deps;
  const current = await workModel.findCanvas(canvasId);
  if (current && current.work.userId !== userId) throw new TRPCError({ code: 'FORBIDDEN' });
  if (current && orphanOnly) return { deleted: false };

  if (!current) {
    // No visible Work: only the caller's own leftover files can be freed. A
    // Work this view cannot see, or nothing of the caller's at all, must not
    // read as a successful delete.
    const hasWork = await new CanvasFileRepository(db, userId, workspaceId).findCanvasWorkId(
      canvasId,
    );
    const hasFiles =
      !hasWork && (await new CanvasFileModel(db, userId, workspaceId).hasCanvasFiles(canvasId));
    if (!hasFiles) {
      if (orphanOnly) return { deleted: false };
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
  }

  // Offline first: if this fails the canvas stays, rather than a public page
  // outliving the canvas it was published from.
  const deploymentId = current?.work.metadata?.canvasPublish?.deploymentId;
  if (deploymentId) await unpublishCanvasSite({ db, deploymentId, userId, workspaceId });

  const removed = current ? await workModel.deleteWork({ id: current.work.id }) : [];
  await storage.removeCanvas(
    canvasId,
    removed.flatMap((row) => row.canvasManifestKeys),
  );
  return { deleted: true };
};
