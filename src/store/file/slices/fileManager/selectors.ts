import { type FilesStoreState } from '@/store/file/initialState';
import { type FileUploadStatus } from '@/types/files/upload';

const uploadStatusArray = new Set(['uploading', 'pending', 'processing']);

const dockFileList = (s: FilesStoreState) => s.dockUploadFileList;
const dockRawFileList = (s: FilesStoreState) => s.dockUploadFileList.map((item) => item.file);
const getFileById = (id?: string | null) => (s: FilesStoreState) => {
  if (!id) return;

  return s.fileList.find((item) => item.id === id);
};

const isUploadingFiles = (s: FilesStoreState) =>
  s.dockUploadFileList.some((file) => uploadStatusArray.has(file.status));

const overviewUploadingStatus = (s: FilesStoreState): FileUploadStatus => {
  if (s.dockUploadFileList.length === 0) return 'pending';
  if (s.dockUploadFileList.some((file) => uploadStatusArray.has(file.status))) {
    return 'uploading';
  }

  return 'success';
};

const overviewUploadingProgress = (s: FilesStoreState) => {
  const uploadFiles = s.dockUploadFileList.filter(
    (file) => file.status === 'uploading' || file.status === 'pending',
  );

  if (uploadFiles.length === 0) return 100;

  const totalPercent = uploadFiles.length * 100;
  const currentPercent = uploadFiles.reduce(
    (acc, file) => acc + (file.uploadState?.progress || 0),
    0,
  );

  return (currentPercent / totalPercent) * 100;
};

const isCreatingFileParseTask = (id: string) => (s: FilesStoreState) =>
  s.creatingChunkingTaskIds.includes(id);

const isCreatingChunkEmbeddingTask = (id: string) => (s: FilesStoreState) =>
  s.creatingEmbeddingTaskIds.includes(id);

const fileListHasMore = (s: FilesStoreState) => s.fileListHasMore;

export const fileManagerSelectors = {
  dockFileList,
  dockRawFileList,
  fileListHasMore,
  getFileById,
  isCreatingChunkEmbeddingTask,
  isCreatingFileParseTask,
  isUploadingFiles,
  overviewUploadingProgress,
  overviewUploadingStatus,
};
