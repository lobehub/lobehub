import type { FileUploadState, FileUploadStatus } from '@/types/files/upload';

export interface EditorFileUploadSnapshot {
  file: File;
  id: string;
  status: FileUploadStatus;
  uploadState?: FileUploadState;
}

export interface EditorFileUploadTracker {
  bindNode: (nodeKey: string, fileName: string) => void;
  finish: (id: string) => void;
  getSnapshot: (nodeKey: string) => EditorFileUploadSnapshot | undefined;
  releaseNode: (nodeKey: string) => void;
  start: (file: File) => string;
  subscribe: (listener: () => void) => () => void;
  update: (id: string, status: FileUploadStatus, uploadState?: FileUploadState) => void;
}

export const createEditorFileUploadTracker = (): EditorFileUploadTracker => {
  const finishedUploadIds = new Set<string>();
  const listeners = new Set<() => void>();
  const nodeFileNames = new Map<string, string>();
  const nodeUploadIds = new Map<string, string>();
  // Keep ownership after an effect cleanup so React Strict Mode can rebind the same node.
  const uploadNodeKeys = new Map<string, string>();
  const uploads = new Map<string, EditorFileUploadSnapshot>();
  let nextId = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const deleteUpload = (id: string) => {
    finishedUploadIds.delete(id);
    uploadNodeKeys.delete(id);
    return uploads.delete(id);
  };

  return {
    bindNode: (nodeKey, fileName) => {
      if (nodeUploadIds.has(nodeKey)) return;

      nodeFileNames.set(nodeKey, fileName);

      const upload =
        [...uploads.values()].find((item) => uploadNodeKeys.get(item.id) === nodeKey) ??
        [...uploads.values()].find(
          (item) => item.file.name === fileName && !uploadNodeKeys.has(item.id),
        );

      if (upload) {
        nodeUploadIds.set(nodeKey, upload.id);
        uploadNodeKeys.set(upload.id, nodeKey);
        emit();
      }
    },
    finish: (id) => {
      if (!uploads.has(id)) return;

      finishedUploadIds.add(id);
      const isBound = [...nodeUploadIds.values()].includes(id);
      if (isBound || !deleteUpload(id)) return;
      emit();
    },
    getSnapshot: (nodeKey) => {
      const uploadId = nodeUploadIds.get(nodeKey);
      return uploadId ? uploads.get(uploadId) : undefined;
    },
    releaseNode: (nodeKey) => {
      nodeFileNames.delete(nodeKey);
      const uploadId = nodeUploadIds.get(nodeKey);
      if (!uploadId) return;

      nodeUploadIds.delete(nodeKey);
      if (finishedUploadIds.has(uploadId)) deleteUpload(uploadId);
      emit();
    },
    start: (file) => {
      const id = String(++nextId);
      uploads.set(id, { file, id, status: 'pending' });

      const pendingNode = [...nodeFileNames.entries()].find(
        ([nodeKey, fileName]) => fileName === file.name && !nodeUploadIds.has(nodeKey),
      );
      if (pendingNode) {
        nodeUploadIds.set(pendingNode[0], id);
        uploadNodeKeys.set(id, pendingNode[0]);
      }

      emit();
      return id;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (id, status, uploadState) => {
      const upload = uploads.get(id);
      if (!upload) return;

      uploads.set(id, { ...upload, status, uploadState });
      emit();
    },
  };
};
