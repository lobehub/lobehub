import {
  buildFolderTree,
  createNanoId,
  sanitizeFolderName,
  topologicalSortFolders,
} from '@lobechat/utils';
import { t } from 'i18next';
import pMap from 'p-map';
import { type SWRResponse } from 'swr';

import { message } from '@/components/AntdStaticMethods';
import { FILE_UPLOAD_BLACKLIST, MAX_UPLOAD_FILE_COUNT } from '@/const/file';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { documentService } from '@/services/document';
import { FileService, fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem, type QueryFileListParams } from '@/types/files';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { unzipFile } from '@/utils/unzipFile';

import { type FileStore } from '../../store';
import { fileManagerSelectors } from './selectors';

const serverFileService = new FileService();
const FETCH_ALL_KNOWLEDGE_KEY = 'useFetchKnowledgeItems';

export interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

type Setter = StoreSetter<FileStore>;
export const createFileManageSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileManageActionImpl(set, get, _api);

export class FileManageActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  cancelUpload = (id: string): void => {
    const { dockUploadFileList, dispatchDockFileList } = this.#get();
    const uploadItem = dockUploadFileList.find((item) => item.id === id);

    if (uploadItem?.abortController) {
      uploadItem.abortController.abort();
    }

    // Update status to cancelled
    dispatchDockFileList({
      id,
      status: 'cancelled',
      type: 'updateFileStatus',
    });
  };

  dispatchDockFileList = (payload: UploadFileListDispatch): void => {
    const nextValue = uploadFileListReducer(this.#get().dockUploadFileList, payload);
    if (nextValue === this.#get().dockUploadFileList) return;

    this.#set({ dockUploadFileList: nextValue }, false, `dispatchDockFileList/${payload.type}`);
  };

  embeddingChunks = async (fileIds: string[]): Promise<void> => {
    // toggle file ids
    this.#get().toggleEmbeddingIds(fileIds);

    // parse files
    const pools = fileIds.map(async (id) => {
      try {
        await ragService.createEmbeddingChunksTask(id);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    await this.#get().refreshFileList();
    this.#get().toggleEmbeddingIds(fileIds, false);
  };

  loadMoreKnowledgeItems = async (): Promise<void> => {
    const { queryListParams, fileList, fileListOffset, fileListHasMore } = this.#get();

    // Don't load if there's no more data or no params
    if (!fileListHasMore || !queryListParams) return;

    try {
      const response = await serverFileService.getKnowledgeItems({
        ...queryListParams,
        limit: queryListParams.limit ?? 50,
        offset: fileListOffset,
      });

      // Deduplicate items by ID to prevent duplicate items at page boundaries
      const existingIds = new Set(fileList.map((item) => item.id));
      const newItems = response.items.filter((item) => !existingIds.has(item.id));
      const updatedFileList = [...fileList, ...newItems];

      // Update Zustand store
      this.#set({
        fileList: updatedFileList,
        fileListHasMore: response.hasMore,
        fileListOffset: fileListOffset + newItems.length,
      });

      // Update SWR cache so the component sees the new items
      await mutate([FETCH_ALL_KNOWLEDGE_KEY, queryListParams], updatedFileList, {
        revalidate: false,
      });
    } catch (error) {
      console.error('Failed to load more knowledge items:', error);
    }
  };

  moveFileToFolder = async (fileId: string, parentId: string | null): Promise<void> => {
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
    await this.#get().refreshFileList();
  };

  parseFilesToChunks = async (ids: string[], params?: { skipExist?: boolean }): Promise<void> => {
    // toggle file ids
    this.#get().toggleParsingIds(ids);

    // parse files
    const pools = ids.map(async (id) => {
      try {
        await ragService.createParseFileTask(id, params?.skipExist);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    await this.#get().refreshFileList();
    this.#get().toggleParsingIds(ids, false);
  };

  pushDockFileList = async (
    rawFiles: File[],
    knowledgeBaseId?: string,
    parentId?: string,
  ): Promise<void> => {
    const { dispatchDockFileList } = this.#get();

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

    // 2. Create upload items with abort controllers
    const uploadFiles = files.map((file) => {
      const abortController = new AbortController();
      return {
        abortController,
        file,
        id: file.name,
        status: 'pending' as const,
      };
    });

    // 3. Add all files to dock
    dispatchDockFileList({
      atStart: true,
      files: uploadFiles,
      type: 'addFiles',
    });

    // 4. Upload files with concurrency limit using p-map
    const uploadResults = await pMap(
      uploadFiles,
      async (uploadFileItem) => {
        const result = await this.#get().uploadWithProgress({
          abortController: uploadFileItem.abortController,
          file: uploadFileItem.file,
          knowledgeBaseId,
          onStatusUpdate: dispatchDockFileList,
          parentId,
        });

        // Note: Don't refresh after each file to avoid flickering
        // We'll refresh once at the end

        return {
          file: uploadFileItem.file,
          fileId: result?.id,
          fileType: uploadFileItem.file.type,
        };
      },
      { concurrency: MAX_UPLOAD_FILE_COUNT },
    );

    // Refresh file list to show newly uploaded files
    await this.#get().refreshFileList();

    // 5. auto-embed files that support chunking
    const fileIdsToEmbed = uploadResults
      .filter(({ fileType, fileId }) => fileId && !isChunkingUnsupported(fileType))
      .map(({ fileId }) => fileId!);

    if (fileIdsToEmbed.length > 0) {
      await this.#get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
    }
  };

  reEmbeddingChunks = async (id: string): Promise<void> => {
    if (fileManagerSelectors.isCreatingChunkEmbeddingTask(id)(this.#get())) return;

    // toggle file ids
    this.#get().toggleEmbeddingIds([id]);

    await serverFileService.removeFileAsyncTask(id, 'embedding');

    await this.#get().refreshFileList();

    await ragService.createEmbeddingChunksTask(id);

    await this.#get().refreshFileList();

    this.#get().toggleEmbeddingIds([id], false);
  };

  reParseFile = async (id: string): Promise<void> => {
    // toggle file ids
    this.#get().toggleParsingIds([id]);

    await ragService.retryParseFile(id);

    await this.#get().refreshFileList();

    this.#get().toggleParsingIds([id], false);
  };

  refreshFileList = async (): Promise<void> => {
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

    // Also revalidate the ResourceManager resource list cache (SWR_RESOURCES)
    // so uploaded files appear immediately in the Explorer without a full refresh.
    const { revalidateResources } = await import('../resource/hooks');
    await revalidateResources();
  };

  removeAllFiles = async (): Promise<void> => {
    await fileService.removeAllFiles();
  };

  removeFileItem = async (id: string): Promise<void> => {
    await fileService.removeFile(id);
    await this.#get().refreshFileList();
  };

  removeFiles = async (ids: string[]): Promise<void> => {
    await fileService.removeFiles(ids);
    await this.#get().refreshFileList();
  };

  renameFolder = async (folderId: string, newName: string): Promise<void> => {
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
    await this.#get().refreshFileList();
  };

  setCurrentFolderId = (folderId: string | null | undefined): void => {
    this.#set({ currentFolderId: folderId }, false, 'setCurrentFolderId');
  };

  setPendingRenameItemId = (id: string | null): void => {
    this.#set({ pendingRenameItemId: id }, false, 'setPendingRenameItemId');
  };

  setUploadDockExpanded = (expanded: boolean): void => {
    this.#set({ uploadDockExpanded: expanded }, false, 'setUploadDockExpanded');
  };

  toggleEmbeddingIds = (ids: string[], loading?: boolean): void => {
    this.#set((state) => {
      const nextValue = new Set(state.creatingEmbeddingTaskIds);

      ids.forEach((id: string) => {
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
  };

  toggleParsingIds = (ids: string[], loading?: boolean): void => {
    this.#set((state) => {
      const nextValue = new Set(state.creatingChunkingTaskIds);

      ids.forEach((id: string) => {
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
  };

  uploadFolderWithStructure = async (
    files: File[],
    knowledgeBaseId?: string,
    currentFolderId?: string,
  ): Promise<void> => {
    const { dispatchDockFileList } = this.#get();

    // 1. Build folder tree from file paths
    const { filesByFolder, folders } = buildFolderTree(files);

    // 2. Sort folders by depth to ensure parents are created before children
    const sortedFolderPaths = topologicalSortFolders(folders);

    // Show toast notification if there are folders to create
    const messageKey = 'uploadFolder.creatingFolders';
    if (sortedFolderPaths.length > 0) {
      message.loading({
        content: t('header.actions.uploadFolder.creatingFolders', { ns: 'file' }),
        duration: 0, // Don't auto-dismiss
        key: messageKey,
      });
    }

    try {
      // Map to store created folder IDs: relative path -> folder ID
      const folderIdMap = new Map<string, string>();

      // 3. Group folders by depth level for batch creation
      const foldersByLevel = new Map<number, string[]>();
      for (const folderPath of sortedFolderPaths) {
        const depth = (folderPath.match(/\//g) || []).length;
        if (!foldersByLevel.has(depth)) {
          foldersByLevel.set(depth, []);
        }
        foldersByLevel.get(depth)!.push(folderPath);
      }

      // 4. Create folders level by level using batch API
      const generateSlug = createNanoId(8);
      const levels = Array.from(foldersByLevel.keys()).sort((a, b) => a - b);
      for (const level of levels) {
        const foldersAtThisLevel = foldersByLevel.get(level)!;

        // Prepare batch creation data for this level
        const batchCreateData = foldersAtThisLevel.map((folderPath) => {
          const folder = folders[folderPath];
          const parentId = folder.parent ? folderIdMap.get(folder.parent) : currentFolderId;
          const sanitizedName = sanitizeFolderName(folder.name);

          // Generate unique slug for the folder
          const slug = generateSlug();

          return {
            content: '',
            editorData: '{}',
            fileType: 'custom/folder',
            knowledgeBaseId,
            metadata: { createdAt: Date.now() },
            parentId,
            slug,
            title: sanitizedName,
          };
        });

        // Create all folders at this level in a single batch request
        const createdFolders = await documentService.createDocuments(batchCreateData);

        // Store folder ID mappings for the next level
        for (const [i, element] of foldersAtThisLevel.entries()) {
          folderIdMap.set(element, createdFolders[i].id);
        }
      }

      // Dismiss the toast after folders are created
      if (sortedFolderPaths.length > 0) {
        message.destroy(messageKey);
      }

      // Refresh file list to show the new folders
      await this.#get().refreshFileList();

      // 5. Prepare all file uploads with their target folder IDs
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

      // 6. Filter out blacklisted files
      const validUploads = allUploads.filter(
        ({ file }) => !FILE_UPLOAD_BLACKLIST.includes(file.name),
      );

      // 7. Add all files to dock
      dispatchDockFileList({
        atStart: true,
        files: validUploads.map(({ file }) => ({ file, id: file.name, status: 'pending' })),
        type: 'addFiles',
      });

      // 8. Upload files with concurrency limit
      const uploadResults = await pMap(
        validUploads,
        async ({ file, parentId }) => {
          const result = await this.#get().uploadWithProgress({
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
      await this.#get().refreshFileList();

      // 9. Auto-embed files that support chunking
      const fileIdsToEmbed = uploadResults
        .filter(({ fileType, fileId }) => fileId && !isChunkingUnsupported(fileType))
        .map(({ fileId }) => fileId!);

      if (fileIdsToEmbed.length > 0) {
        await this.#get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
      }
    } catch (error) {
      // Dismiss toast on error
      if (sortedFolderPaths.length > 0) {
        message.destroy(messageKey);
      }
      throw error;
    }
  };

  useFetchFolderBreadcrumb = (slug?: string | null): SWRResponse<FolderCrumb[]> => {
    return useClientDataSWR<FolderCrumb[]>(
      !slug ? null : ['useFetchFolderBreadcrumb', slug],
      async () => {
        const response = await serverFileService.getFolderBreadcrumb(slug!);
        return response;
      },
    );
  };

  useFetchKnowledgeItem = (id?: string): SWRResponse<FileListItem | undefined> => {
    return useClientDataSWR<FileListItem | undefined>(
      !id ? null : ['useFetchKnowledgeItem', id],
      async () => {
        const response = await serverFileService.getKnowledgeItem(id!);
        return response ?? undefined;
      },
    );
  };

  useFetchKnowledgeItems = (params: QueryFileListParams): SWRResponse<FileListItem[]> => {
    return useClientDataSWR<FileListItem[]>([FETCH_ALL_KNOWLEDGE_KEY, params], async () => {
      const response = await serverFileService.getKnowledgeItems({
        ...params,
        limit: params.limit ?? 50,
        offset: 0,
      });

      // Update store immediately with response data (no duplicate fetch!)
      this.#set({
        fileList: response.items,
        fileListHasMore: response.hasMore,
        fileListOffset: response.items.length,
        queryListParams: params,
      });

      return response.items;
    });
  };
}

export type FileManageAction = Pick<FileManageActionImpl, keyof FileManageActionImpl>;
