import debug from 'debug';
import { useCallback } from 'react';

const log = debug('lobe-client:drag-upload:local');

export type DragContentKind = 'files' | 'folders' | 'mixed' | 'none';

export interface DroppedLocalPath {
  isDirectory: boolean;
  name: string;
  path: string;
}

export interface PartitionedDroppedLocalPaths {
  files: File[];
  localPaths: DroppedLocalPath[];
}

/**
 * Resolve the absolute filesystem path of a dropped File in Electron.
 * Returns null when not running under Electron or the path cannot be resolved.
 */
const resolveElectronFilePath = (file: File): string | null => {
  const webUtils = (
    globalThis as unknown as {
      window?: { electron?: { webUtils?: { getPathForFile?: (file: File) => string } } };
    }
  ).window?.electron?.webUtils;
  if (!webUtils?.getPathForFile) {
    log('webUtils.getPathForFile unavailable on window.electron — local path cannot be resolved');
    return null;
  }
  try {
    const result = webUtils.getPathForFile(file);
    if (!result) log('webUtils.getPathForFile returned empty for %s', file.name);
    return result || null;
  } catch (error) {
    log('webUtils.getPathForFile threw for %s: %O', file.name, error);
    return null;
  }
};

const safeGetEntry = (item: DataTransferItem): FileSystemEntry | null => {
  try {
    return item.webkitGetAsEntry();
  } catch {
    return null;
  }
};

/**
 * Process a FileSystemEntry recursively to extract all files
 */
const processEntry = async (entry: FileSystemEntry): Promise<File[]> => {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => {
        resolve([file]);
      });
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      dirReader.readEntries(async (entries) => {
        const filesPromises = entries.map((element) => processEntry(element));
        const fileArrays = await Promise.all(filesPromises);
        resolve(fileArrays.flat());
      });
    } else {
      resolve([]);
    }
  });
};

/**
 * Extract files from DataTransferItems, supporting both files and directories
 */
export const getFileListFromDataTransferItems = async (
  items: DataTransferItem[],
): Promise<File[]> => {
  const filePromises: Promise<File[]>[] = [];

  for (const item of items) {
    if (item.kind === 'file') {
      // Safari browser may throw error when using FileSystemFileEntry.file()
      // So we prioritize using getAsFile() method first for better browser compatibility
      const file = item.getAsFile();

      if (file) {
        filePromises.push(Promise.resolve([file]));
      } else {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          filePromises.push(processEntry(entry));
        }
      }
    }
  }

  const fileArrays = await Promise.all(filePromises);
  return fileArrays.flat();
};

/**
 * Inspect DataTransferItems synchronously (callable in dragenter / dragover)
 * to classify dragged content into 'files', 'folders', 'mixed', or 'none'.
 *
 * Browsers expose item.webkitGetAsEntry() during drag events with metadata
 * (isFile / isDirectory) accessible, even though content reads are gated to drop.
 */
export const detectDragContentKind = (items: DataTransferItemList | null): DragContentKind => {
  if (!items || items.length === 0) return 'none';

  let hasFolder = false;
  let hasFile = false;

  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const entry = safeGetEntry(item);
    if (entry?.isDirectory) {
      hasFolder = true;
    } else {
      hasFile = true;
    }
    if (hasFolder && hasFile) break;
  }

  if (hasFolder && hasFile) return 'mixed';
  if (hasFolder) return 'folders';
  if (hasFile) return 'files';
  return 'none';
};

/**
 * Partition dropped DataTransferItems into top-level local path references (with
 * absolute filesystem paths via Electron's webUtils) and upload fallback files.
 * Folders are NOT recursed into when their path resolves — the caller is
 * expected to reference the folder itself.
 *
 * When a path cannot be resolved (e.g. running in browser), the item falls back
 * to upload. Directories are flattened so the user does not silently lose data.
 */
export const partitionDroppedItemsAsLocalPaths = async (
  items: DataTransferItem[],
): Promise<PartitionedDroppedLocalPaths> => {
  const files: File[] = [];
  const localPaths: DroppedLocalPath[] = [];

  for (const item of items) {
    if (item.kind !== 'file') continue;

    const entry = safeGetEntry(item);
    const topLevelFile = item.getAsFile();
    const path = topLevelFile ? resolveElectronFilePath(topLevelFile) : null;

    if (path) {
      localPaths.push({
        isDirectory: !!entry?.isDirectory,
        name: topLevelFile?.name || entry?.name || path.split('/').pop() || path,
        path,
      });
      continue;
    }

    if (entry?.isDirectory) {
      const flattened = await processEntry(entry);
      files.push(...flattened);
      continue;
    }

    if (topLevelFile) {
      files.push(topLevelFile);
    } else if (entry) {
      const flattened = await processEntry(entry);
      files.push(...flattened);
    }
  }

  return { files, localPaths };
};

export interface UseLocalDragUploadOptions {
  /**
   * Whether the drag upload is disabled
   */
  disabled?: boolean;
  /**
   * When true, top-level files and folders are routed to onLocalPaths instead of
   * being uploaded. Requires Electron (uses webUtils.getPathForFile) to resolve
   * absolute filesystem paths.
   */
  enableLocalPathReference?: boolean;
  /**
   * Callback for top-level dropped files and folders when local path reference
   * mode is on.
   */
  onLocalPaths?: (paths: DroppedLocalPath[]) => void | Promise<void>;
  /**
   * Callback when files are dropped
   */
  onUploadFiles: (files: File[]) => void | Promise<void>;
}

export interface UseLocalDragUploadResult {
  /**
   * Props to spread on the container element
   */
  getContainerProps: () => {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

/**
 * Hook for handling local (container-scoped) drag and drop file uploads.
 *
 * This hook only handles dragOver (to allow drop) and drop events.
 * The global drag state is managed by DragUploadProvider.
 *
 * IMPORTANT: We intentionally do NOT call stopPropagation() to allow
 * events to bubble up to the window where DragUploadProvider listens.
 */
export const useLocalDragUpload = (
  options: UseLocalDragUploadOptions,
): UseLocalDragUploadResult => {
  const { onUploadFiles, disabled = false, enableLocalPathReference, onLocalPaths } = options;

  // Only preventDefault to allow drop, do NOT stopPropagation
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      if (!e.dataTransfer?.types.includes('Files')) return;

      e.preventDefault();
      // Do NOT call stopPropagation - let event bubble to Provider
    },
    [disabled],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled) return;
      if (!e.dataTransfer?.items || e.dataTransfer.items.length === 0) return;

      const isFile = e.dataTransfer.types.includes('Files');
      if (!isFile) return;

      e.preventDefault();
      // Do NOT call stopPropagation - let event bubble to Provider

      const items = Array.from(e.dataTransfer.items);

      if (enableLocalPathReference && onLocalPaths) {
        const { localPaths, files } = await partitionDroppedItemsAsLocalPaths(items);
        log(
          'drop partitioned: %d local path(s), %d upload fallback file(s)',
          localPaths.length,
          files.length,
        );
        if (localPaths.length > 0) {
          await onLocalPaths(localPaths);
        }
        if (files.length > 0) {
          await onUploadFiles(files);
        }
        return;
      }

      log('drop without local-path reference, uploading files only');
      const files = await getFileListFromDataTransferItems(items);
      if (files.length === 0) return;
      await onUploadFiles(files);
    },
    [disabled, enableLocalPathReference, onLocalPaths, onUploadFiles],
  );

  const getContainerProps = useCallback(
    () => ({
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    }),
    [handleDragOver, handleDrop],
  );

  return {
    getContainerProps,
  };
};
