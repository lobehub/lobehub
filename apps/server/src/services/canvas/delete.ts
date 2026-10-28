import { TRPCError } from '@trpc/server';

import type { WorkModel } from '@/database/models/work';

import type { CanvasStorageService } from './storage';

/**
 * Delete one of the caller's canvases outright: its Work (with every version)
 * and every file it registered, which is what frees its storage usage. A
 * canvas whose Work is already gone still has its files removed.
 */
export const deleteCanvas = async (
  canvasId: string,
  deps: { storage: CanvasStorageService; userId: string; workModel: WorkModel },
) => {
  const { storage, userId, workModel } = deps;
  const current = await workModel.findCanvas(canvasId);
  if (current && current.work.userId !== userId) throw new TRPCError({ code: 'FORBIDDEN' });

  const removed = current ? await workModel.deleteWork({ id: current.work.id }) : [];
  await storage.removeCanvas(
    canvasId,
    removed.flatMap((row) => row.canvasManifestKeys),
  );
};
