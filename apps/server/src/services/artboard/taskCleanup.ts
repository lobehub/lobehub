import { ArtboardModel } from '@/database/models/artboard';
import { ArtboardFileModel } from '@/database/models/artboardFile';
import { WorkModel } from '@/database/models/work';
import type { ArtboardWork } from '@/database/models/work/artboard';
import { FileService } from '@/server/services/file';

import {
  type ArtboardBlobStore,
  createFileServiceArtboardBlobStore,
  removeArtboardFiles,
} from './files';
import { type ArtboardShareOwner, unpublishArtboardWork } from './publish/offline';

export interface TaskArtboards {
  artboardIds: string[];
  works: ArtboardWork[];
}

const unpublishShared = async (owner: ArtboardShareOwner, works: ArtboardWork[]) => {
  const offline: string[] = [];
  for (const work of works) {
    if (!work.metadata?.artboardPublish || !work.resourceId) continue;
    try {
      await unpublishArtboardWork(owner, work);
      offline.push(work.resourceId);
    } catch (error) {
      console.error('[artboard:task-cleanup] share teardown failed', work.resourceId, error);
    }
  }
  return offline;
};

export const collectTaskArtboards = async (
  owner: ArtboardShareOwner,
  taskIds: string[],
): Promise<TaskArtboards> => {
  const rows = await new ArtboardModel(
    owner.db,
    owner.userId,
    owner.workspaceId,
  ).listByTrashedTaskIds(taskIds);
  const artboardIds = rows.map((row) => row.id);
  const works = await new WorkModel(
    owner.db,
    owner.userId,
    owner.workspaceId,
  ).findArtboardWorksForTrash(artboardIds);
  return { artboardIds, works };
};

export const takeTaskArtboardsOffline = async (owner: ArtboardShareOwner, taskIds: string[]) => {
  const { works } = await collectTaskArtboards(owner, taskIds);
  const offline = await unpublishShared(owner, works);
  await new WorkModel(owner.db, owner.userId, owner.workspaceId).clearArtboardPublishForTrash(
    offline,
  );
};

export const deleteTaskArtboardRecords = async (
  owner: ArtboardShareOwner,
  { artboardIds }: TaskArtboards,
) => {
  await new WorkModel(owner.db, owner.userId, owner.workspaceId).deleteArtboardWorksForTrash(
    artboardIds,
  );
  await new ArtboardFileModel(owner.db, owner.userId, owner.workspaceId).deleteByArtboards(
    artboardIds,
  );
  await new ArtboardModel(owner.db, owner.userId, owner.workspaceId).deleteForTrashPurge(
    artboardIds,
  );
};

export const releaseTaskArtboards = async (
  owner: ArtboardShareOwner,
  { artboardIds, works }: TaskArtboards,
  store: ArtboardBlobStore = createFileServiceArtboardBlobStore(
    () => new FileService(owner.db, owner.userId, owner.workspaceId),
  ),
) => {
  await unpublishShared(owner, works);
  for (const artboardId of artboardIds) {
    try {
      await removeArtboardFiles(store, artboardId);
    } catch (error) {
      console.error('[artboard:task-cleanup] file removal failed', artboardId, error);
    }
  }
};
