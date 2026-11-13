import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type FileListItem } from '@/types/files';
import { type UploadFileItem } from '@/types/files/upload';

import {
  type FileDetailValue,
  type FileListData,
  type FileListMeta,
  type FolderCrumb,
} from './projection';

export interface FileManagerState {
  creatingChunkingTaskIds: string[];
  creatingEmbeddingTaskIds: string[];
  currentFolderId?: string | null;
  dockUploadFileList: UploadFileItem[];
  /**
   * One knowledge item per id — the replica view of `fileDetail`. Selectors read
   * this location; the replica slice is its only writer. `file: null` means the
   * server answered "not found".
   */
  fileDetailMap: Record<string, FileDetailValue>;
  /** Replica bookkeeping of `fileDetailMap`. */
  fileDetailReplica: ReplicaState<FileDetailValue>;
  /**
   * Rows of the knowledge-item list — the replica view of `fileList`, kept as a
   * flat array where every existing reader expects it.
   */
  fileList: FileListItem[];
  /** Paging bookkeeping of `fileList` (part of the replica view). */
  fileListMeta?: FileListMeta;
  /** Replica bookkeeping of `fileList`. */
  fileListReplica: ReplicaState<FileListData>;
  /** A folder's ancestor chain per slug — the replica view of `folderBreadcrumb`. */
  folderBreadcrumbMap: Record<string, FolderCrumb[]>;
  /** Replica bookkeeping of `folderBreadcrumbMap`. */
  folderBreadcrumbReplica: ReplicaState<FolderCrumb[]>;
  pendingRenameItemId: string | null;
}

export const initialFileManagerState: FileManagerState = {
  creatingChunkingTaskIds: [],
  creatingEmbeddingTaskIds: [],
  currentFolderId: undefined,
  dockUploadFileList: [],
  fileDetailMap: {},
  fileDetailReplica: createReplicaState(),
  fileList: [],
  fileListMeta: undefined,
  fileListReplica: createReplicaState(),
  folderBreadcrumbMap: {},
  folderBreadcrumbReplica: createReplicaState(),
  pendingRenameItemId: null,
};
