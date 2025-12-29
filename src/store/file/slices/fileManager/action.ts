import { buildFolderTree, sanitizeFolderName, topologicalSortFolders } from '@lobechat/utils';
import pMap from 'p-map';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { FILE_UPLOAD_BLACKLIST, MAX_UPLOAD_FILE_COUNT } from '@/const/file';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { FileService, fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import {
  type UploadFileListDispatch,
  uploadFileListReducer,
} from '@/store/file/reducers/uploadFileList';
import { type FileListItem, type QueryFileListParams } from '@/types/files';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { unzipFile } from '@/utils/unzipFile';

import { type FileStore } from '../../store';
import { fileManagerSelectors } from './selectors';

const serverFileService = new FileService();

export interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

export interface FileManageAction {
  dispatchDockFileList: (payload: UploadFileListDispatch) => void;
  embeddingChunks: (fileIds: string[]) => Promise<void>;
  loadMoreKnowledgeItems: () => Promise<void>;
  moveFileToFolder: (fileId: string, parentId: string | null) => Promise<void>;
  parseFilesToChunks: (ids: string[], params?: { skipExist?: boolean }) => Promise<void>;
  pushDockFileList: (files: File[], knowledgeBaseId?: string, parentId?: string) => Promise<void>;

  reEmbeddingChunks: (id: string) => Promise<void>;
  reParseFile: (id: string) => Promise<void>;
  refreshFileList: () => Promise<void>;
  removeAllFiles: () => Promise<void>;
  removeFileItem: (id: string) => Promise<void>;
  removeFiles: (ids: string[]) => Promise<void>;
  renameFolder: (folderId: string, newName: string) => Promise<void>;

  setCurrentFolderId: (folderId: string | null | undefined) => void;
  setPendingRenameItemId: (id: string | null) => void;

  toggleEmbeddingIds: (ids: string[], loading?: boolean) => void;
  toggleParsingIds: (ids: string[], loading?: boolean) => void;

  uploadFolderWithStructure: (
    files: File[],
    knowledgeBaseId?: string,
    currentFolderId?: string,
  ) => Promise<void>;

  useFetchFolderBreadcrumb: (slug?: string | null) => SWRResponse<FolderCrumb[]>;
  useFetchKnowledgeItem: (id?: string) => SWRResponse<FileListItem | undefined>;
  useFetchKnowledgeItems: (params: QueryFileListParams) => SWRResponse<FileListItem[]>;
}

const FETCH_ALL_KNOWLEDGE_KEY = 'useFetchKnowledgeItems';

export const createFileManageSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  FileManageAction
> = (set, get) => ({
  dispatchDockFileList: (payload: UploadFileListDispatch) => {
    const nextValue = uploadFileListReducer(get().dockUploadFileList, payload);
    if (nextValue === get().dockUploadFileList) return;

    set({ dockUploadFileList: nextValue }, false, `dispatchDockFileList/${payload.type}`);
  },
  embeddingChunks: async (fileIds: string[]) => {
    // toggle file ids
    get().toggleEmbeddingIds(fileIds);

    // parse files
    const pools = fileIds.map(async (id) => {
      try {
        await ragService.createEmbeddingChunksTask(id);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    await get().refreshFileList();
    get().toggleEmbeddingIds(fileIds, false);
  },

  loadMoreKnowledgeItems: async () => {
    const { queryListParams, fileList, fileListOffset, fileListHasMore } = get();

    // Don't load if there's no more data or no params
    if (!fileListHasMore || !queryListParams) return;

    try {
      const response = await serverFileService.getKnowledgeItems({
        ...queryListParams,
        limit: queryListParams.limit ?? 50,
        offset: fileListOffset,
      });

      set({
        fileList: [...fileList, ...response.items],
        fileListHasMore: response.hasMore,
        fileListOffset: fileListOffset + response.items.length,
      });
    } catch (error) {
      console.error('Failed to load more knowledge items:', error);
    }
  },

  moveFileToFolder: async (fileId, parentId) => {
    // Optimistically update all file list caches
    await mutate(
      (key) => Array.isArray(key) && key[0] === FETCH_ALL_KNOWLEDGE_KEY,
      async (currentData: FileListItem[] | undefined) => {
        if (!currentData) return currentData;
        // Update the moved file's parentId in the cache
        return currentData.map((item) => (item.id === fileId ? { ...item, parentId } : item));
      },
      {
        revalidate: false, // Don't revalidate yet
      },
    );

    // Perform the actual update
    await fileService.updateFile(fileId, { parentId });

    // Revalidate to get fresh data from server
    await get().refreshFileList();
  },
  parseFilesToChunks: async (ids: string[], params) => {
    // toggle file ids
    get().toggleParsingIds(ids);

    // parse files
    const pools = ids.map(async (id) => {
      try {
        await ragService.createParseFileTask(id, params?.skipExist);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    await get().refreshFileList();
    get().toggleParsingIds(ids, false);
  },

  pushDockFileList: async (rawFiles, knowledgeBaseId, parentId) => {
    const { dispatchDockFileList } = get();

    // 0. Process ZIP files and extract their contents
    const filesToUpload: File[] = [];
    for (const file of rawFiles) {
      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        try {
          const extractedFiles = await unzipFile(file);
          filesToUpload.push(...extractedFiles);
        } catch (error) {
          console.error('Failed to extract ZIP file:', error);
          // If extraction fails, treat it as a regular file
          filesToUpload.push(file);
        }
      } else {
        filesToUpload.push(file);
      }
    }

    // 1. skip file in blacklist
    const files = filesToUpload.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));

    // 2. Add all files to dock
    dispatchDockFileList({
      atStart: true,
      files: files.map((file) => ({ file, id: file.name, status: 'pending' })),
      type: 'addFiles',
    });

    // 3. Upload files with concurrency limit using p-map
    const uploadResults = await pMap(
      files,
      async (file) => {
        const result = await get().uploadWithProgress({
          file,
          knowledgeBaseId,
          onStatusUpdate: dispatchDockFileList,
          parentId,
        });

        // Note: Don't refresh after each file to avoid flickering
        // We'll refresh once at the end

        return { file, fileId: result?.id, fileType: file.type };
      },
      { concurrency: MAX_UPLOAD_FILE_COUNT },
    );

    // Refresh the file list once after all uploads are complete
    await get().refreshFileList();

    // 4. auto-embed files that support chunking
    const fileIdsToEmbed = uploadResults
      .filter(({ fileType, fileId }) => fileId && !isChunkingUnsupported(fileType))
      .map(({ fileId }) => fileId!);

    if (fileIdsToEmbed.length > 0) {
      await get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
    }
  },
  reEmbeddingChunks: async (id) => {
    if (fileManagerSelectors.isCreatingChunkEmbeddingTask(id)(get())) return;

    // toggle file ids
    get().toggleEmbeddingIds([id]);

    await serverFileService.removeFileAsyncTask(id, 'embedding');

    await get().refreshFileList();

    await ragService.createEmbeddingChunksTask(id);

    await get().refreshFileList();

    get().toggleEmbeddingIds([id], false);
  },
  reParseFile: async (id) => {
    // toggle file ids
    get().toggleParsingIds([id]);

    await ragService.retryParseFile(id);

    await get().refreshFileList();

    get().toggleParsingIds([id], false);
  },
  refreshFileList: async () => {
    // Invalidate all queries that start with FETCH_ALL_KNOWLEDGE_KEY
    // This ensures all file lists (explorer, tree, etc.) are refreshed
    // Note: We don't pass data as undefined to avoid clearing the cache,
    // which would cause isLoading to become true and show skeleton screen
    await mutate(
      (key) => Array.isArray(key) && key[0] === FETCH_ALL_KNOWLEDGE_KEY,
      async (currentData) => currentData,
      {
        revalidate: true,
      },
    );
  },
  removeAllFiles: async () => {
    await fileService.removeAllFiles();
  },

  removeFileItem: async (id) => {
    await fileService.removeFile(id);
    await get().refreshFileList();
  },

  removeFiles: async (ids) => {
    await fileService.removeFiles(ids);
    await get().refreshFileList();
  },

  renameFolder: async (folderId, newName) => {
    // Optimistically update all file list caches
    await mutate(
      (key) => Array.isArray(key) && key[0] === FETCH_ALL_KNOWLEDGE_KEY,
      async (currentData: FileListItem[] | undefined) => {
        if (!currentData) return currentData;
        // Update the folder's name in the cache
        return currentData.map((item) =>
          item.id === folderId ? { ...item, name: newName } : item,
        );
      },
      {
        revalidate: false, // Don't revalidate yet
      },
    );

    // Perform the actual update
    const { documentService } = await import('@/services/document');
    await documentService.updateDocument({ id: folderId, title: newName });

    // Revalidate to get fresh data from server
    await get().refreshFileList();
  },

  setCurrentFolderId: (folderId) => {
    set({ currentFolderId: folderId }, false, 'setCurrentFolderId');
  },

  setPendingRenameItemId: (id) => {
    set({ pendingRenameItemId: id }, false, 'setPendingRenameItemId');
  },

  toggleEmbeddingIds: (ids, loading) => {
    set((state) => {
      const nextValue = new Set(state.creatingEmbeddingTaskIds);

      ids.forEach((id) => {
        if (typeof loading === 'undefined') {
          if (nextValue.has(id)) nextValue.delete(id);
          else nextValue.add(id);
        } else {
          if (loading) nextValue.add(id);
          else nextValue.delete(id);
        }
      });

      return { creatingEmbeddingTaskIds: Array.from(nextValue.values()) };
    });
  },
  toggleParsingIds: (ids, loading) => {
    set((state) => {
      const nextValue = new Set(state.creatingChunkingTaskIds);

      ids.forEach((id) => {
        if (typeof loading === 'undefined') {
          if (nextValue.has(id)) nextValue.delete(id);
          else nextValue.add(id);
        } else {
          if (loading) nextValue.add(id);
          else nextValue.delete(id);
        }
      });

      return { creatingChunkingTaskIds: Array.from(nextValue.values()) };
    });
  },

  uploadFolderWithStructure: async (files, knowledgeBaseId, currentFolderId) => {
    const { dispatchDockFileList } = get();

    // 1. Build folder tree from file paths
    const { filesByFolder, folders } = buildFolderTree(files);

    // 2. Sort folders by depth to ensure parents are created before children
    const sortedFolderPaths = topologicalSortFolders(folders);

    // Map to store created folder IDs: relative path -> folder ID
    const folderIdMap = new Map<string, string>();

    // 3. Create all folders sequentially (maintaining hierarchy)
    for (const folderPath of sortedFolderPaths) {
      const folder = folders[folderPath];

      // Determine parent ID: either from previously created folder or current folder
      const parentId = folder.parent ? folderIdMap.get(folder.parent) : currentFolderId;

      // Sanitize folder name to remove invalid characters
      const sanitizedName = sanitizeFolderName(folder.name);

      // Create folder
      const folderId = await get().createFolder(sanitizedName, parentId, knowledgeBaseId);

      // Store mapping for child folders
      folderIdMap.set(folderPath, folderId);
    }

    // 4. Prepare all file uploads with their target folder IDs
    const allUploads: Array<{ file: File; parentId: string | undefined }> = [];

    for (const [folderPath, folderFiles] of Object.entries(filesByFolder)) {
      // Root-level files (no folder path) go to currentFolderId
      const targetFolderId = folderPath ? folderIdMap.get(folderPath) : currentFolderId;

      allUploads.push(
        ...folderFiles.map((file) => ({
          file,
          parentId: targetFolderId,
        })),
      );
    }

    // 5. Filter out blacklisted files
    const validUploads = allUploads.filter(
      ({ file }) => !FILE_UPLOAD_BLACKLIST.includes(file.name),
    );

    // 6. Add all files to dock
    dispatchDockFileList({
      atStart: true,
      files: validUploads.map(({ file }) => ({ file, id: file.name, status: 'pending' })),
      type: 'addFiles',
    });

    // 7. Upload files with concurrency limit
    const uploadResults = await pMap(
      validUploads,
      async ({ file, parentId }) => {
        const result = await get().uploadWithProgress({
          file,
          knowledgeBaseId,
          onStatusUpdate: dispatchDockFileList,
          parentId,
        });

        // Note: Don't refresh after each file to avoid flickering
        // We'll refresh once at the end

        return { file, fileId: result?.id, fileType: file.type };
      },
      { concurrency: MAX_UPLOAD_FILE_COUNT },
    );

    // Refresh the file list once after all uploads are complete
    await get().refreshFileList();

    // 8. Auto-embed files that support chunking
    const fileIdsToEmbed = uploadResults
      .filter(({ fileType, fileId }) => fileId && !isChunkingUnsupported(fileType))
      .map(({ fileId }) => fileId!);

    if (fileIdsToEmbed.length > 0) {
      await get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
    }
  },

  useFetchFolderBreadcrumb: (slug) =>
    useClientDataSWR<FolderCrumb[]>(!slug ? null : ['useFetchFolderBreadcrumb', slug], async () => {
      const response = await serverFileService.getFolderBreadcrumb(slug!);
      return response;
    }),

  useFetchKnowledgeItem: (id) =>
    useClientDataSWR<FileListItem | undefined>(!id ? null : ['useFetchKnowledgeItem', id], () =>
      serverFileService.getKnowledgeItem(id!),
    ),

  useFetchKnowledgeItems: (params) =>
    useClientDataSWR<FileListItem[]>(
      [FETCH_ALL_KNOWLEDGE_KEY, params],
      async () => {
        const response = await serverFileService.getKnowledgeItems({
          ...params,
          limit: params.limit ?? 50,
          offset: 0,
        });

        // Update store immediately with response data (no duplicate fetch!)
        set({
          fileList: response.items,
          fileListHasMore: response.hasMore,
          fileListOffset: response.items.length,
          queryListParams: params,
        });

        return response.items;
      },
    ),
});
