import { TRPCError } from '@trpc/server';

import { unpublishCanvasSite } from '@/business/server/canvasPublish';
import type { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';

import type { CanvasStorageService } from './storage';

/**
 * Delete one of the caller's canvases outright: its public site, its Work
 * (with every version) and every file it registered, which is what frees its
 * storage usage. A canvas whose Work is already gone still has its files
 * removed.
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
) => {
  const { db, storage, userId, workModel, workspaceId } = deps;
  const current = await workModel.findCanvas(canvasId);
  if (current && current.work.userId !== userId) throw new TRPCError({ code: 'FORBIDDEN' });

  // Offline first: if this fails the canvas stays, rather than a public page
  // outliving the canvas it was published from.
  const deploymentId = current?.work.metadata?.canvasPublish?.deploymentId;
  if (deploymentId) await unpublishCanvasSite({ db, deploymentId, userId, workspaceId });

  const removed = current ? await workModel.deleteWork({ id: current.work.id }) : [];
  await storage.removeCanvas(
    canvasId,
    removed.flatMap((row) => row.canvasManifestKeys),
  );
};
