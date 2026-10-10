import {
  buildFolderTree,
  createNanoId,
  sanitizeFolderName,
  topologicalSortFolders,
} from '@lobechat/utils';
import { toast, type ToastInstance } from '@lobehub/ui';
import { t } from 'i18next';
import pMap from 'p-map';

import { FILE_UPLOAD_BLACKLIST, MAX_UPLOAD_FILE_COUNT } from '@/const/file';
import { isChunkingSupported } from '@/libs/document-loaders/loaderType';
import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaEntityAdapter,
  type ReplicaLens,
  type ReplicaPageResult,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { documentService } from '@/services/document';
import { FileService, fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem, type QueryFileListParams } from '@/types/files';
import { type ResourceItem } from '@/types/resource';
import { isTrpcErrorCode } from '@/utils/trpcError';
import { unzipFile } from '@/utils/unzipFile';

import { type FileStore, useFileStore } from '../../store';
import {
  DEFAULT_FILE_LIST_PAGE_SIZE,
  FILE_LIST_KEY,
  fileDetailResource,
  type FileDetailValue,
  type FileListData,
  type FileListParams,
  fileListResource,
  folderBreadcrumbResource,
  type FolderCrumb,
} from './projection';
import { fileManagerSelectors } from './selectors';

const serverFileService = new FileService();

interface RefreshFileListOptions {
  revalidateResources?: boolean;
}

/**
 * Result of {@link FileManageActionImpl.useFetchKnowledgeItem}.
 *
 * `data` is the replica view, read from the store (not from the hook's return)
 * so a reload or a return to the route paints the persisted projection first and
 * the network only confirms it: `undefined` = nothing loaded for this id yet,
 * `null` on the server is mapped to `undefined`.
 */
export interface UseFetchKnowledgeItemResult {
  data: FileListItem | undefined;
  error: unknown;
  /** SWR's `isLoading` semantics: no value yet and no error. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-run the network sync for this item. */
  mutate: () => Promise<unknown>;
}

/** Result of {@link FileManageActionImpl.useFetchFolderBreadcrumb}. */
export interface UseFetchFolderBreadcrumbResult {
  /** The ancestor chain; `[]` while nothing is loaded or the folder is at the root. */
  data: FolderCrumb[];
  error: unknown;
  isLoading: boolean;
  isValidating: boolean;
  mutate: () => Promise<unknown>;
}

const EMPTY_CRUMBS: FolderCrumb[] = [];

/**
 * The knowledge-item list lives in a flat array (`fileList`) with its paging
 * bookkeeping in a sibling field (`fileListMeta`), so every reader of the list
 * keeps the shape it already had while the replica owns hydration, paging and
 * optimistic overlays.
 */
const fileListLens: ReplicaLens<FileStore, FileListData> = {
  clear: () => ({ fileList: [], fileListMeta: undefined }),
  get: (state) => {
    if (!state.fileListMeta) return undefined;
    return { ...state.fileListMeta, items: state.fileList };
  },
  set: (_state, _key, data) => {
    if (data === undefined) return { fileList: [], fileListMeta: undefined };
    const { items, ...meta } = data;
    return { fileList: items, fileListMeta: meta };
  },
};

/**
 * How one knowledge item sits in `fileDetailMap[id]`. A "not found" answer
 * (`file: null`) is a page state, not a row: deleting the entity drops the whole
 * value, and patching it maps the row it wraps.
 */
const fileDetailEntity: ReplicaEntityAdapter<FileDetailValue, FileListItem> = {
  has: (data, id) => !!data.file && data.file.id === id,
  map: (data, _id, fn) => {
    if (!data.file) return data;
    const next = fn(data.file);
    if (next === undefined) return undefined;
    if (next === data.file) return data;
    return { ...data, file: next };
  },
};

type Setter = StoreSetter<FileStore>;
export const createFileManageSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileManageActionImpl(set, get, _api);

export class FileManageActionImpl {
  readonly #get: () => FileStore;
  /**
   * The knowledge-item list is a `@lobechat/replica` paged resource: the
   * persisted head page paints before the network answers and "load more"
   * appends further pages through the engine instead of a hand-rolled offset.
   */
  readonly #fileList;
  /**
   * By-id knowledge-item detail. Linked with the list below, so a rename or a
   * move updates every copy of the same file the client holds.
   */
  readonly #fileDetail;
  readonly #folderBreadcrumb;
  /** The same file lives in the list and in every loaded detail entry. */
  readonly #fileEntity;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;

    this.#fileList = createReplicaSlice(fileListResource, {
      actionPrefix: 'fileList',
      fetcher: (params, cursor) => this.#fetchFileListPage(params, cursor),
      get,
      set,
      stateKey: 'fileListReplica',
      view: fileListLens,
    });
    this.#fileDetail = createReplicaSlice(fileDetailResource, {
      actionPrefix: 'fileDetail',
      entity: fileDetailEntity,
      fetcher: async (id) => ({ file: await this.#fetchFileDetail(id) }),
      get,
      set,
      stateKey: 'fileDetailReplica',
      // A "not found" answer is a page state, not a row: the view keeps it so
      // consumers stop rendering, but the prior persisted projection must go.
      // `null` drops any stored row, so a reload cannot paint a file the server
      // has already confirmed missing.
      toPersisted: (data) => (data.file ? data : null),
      view: recordLens<FileStore, FileDetailValue>('fileDetailMap'),
    });
    this.#folderBreadcrumb = createReplicaSlice(folderBreadcrumbResource, {
      actionPrefix: 'folderBreadcrumb',
      fetcher: (slug) => serverFileService.getFolderBreadcrumb(slug),
      get,
      set,
      stateKey: 'folderBreadcrumbReplica',
      view: recordLens<FileStore, FolderCrumb[]>('folderBreadcrumbMap'),
    });
    this.#fileEntity = linkReplicaEntity<FileListItem>([this.#fileList, this.#fileDetail]);
  }

  #resolveChunkTargetId = async (id: string): Promise<string> => {
    // Reuse the selector so local resolution consults every store list
    // (fileList → resourceMap → resourceMap-by-fileId → resourceList).
    const localResource = fileManagerSelectors.getFileByChunkTargetId(id)(this.#get());
    if (localResource?.fileId) return localResource.fileId;
    if (!id.startsWith('docs_')) return id;

    try {
      const resource = await fileService.getKnowledgeItem(id);
      return resource?.fileId ?? id;
    } catch {
      return id;
    }
  };

  #resolveChunkTargetIds = async (ids: string[]): Promise<string[]> =>
    Promise.all(ids.map((id) => this.#resolveChunkTargetId(id)));

  /**
   * One knowledge item, with the server's "not found" mapped to a confirmed
   * absence (`{ file: null }`) instead of a rejection. `getKnowledgeItem` throws
   * `NOT_FOUND` for a deleted or inaccessible `file_*` id, which would otherwise
   * leave the hydrated projection in place and surface only a revalidation
   * error — consumers ignore that error and keep rendering the stale file.
   */
  #fetchFileDetail = async (id: string): Promise<FileListItem | null> => {
    try {
      return (await serverFileService.getKnowledgeItem(id)) ?? null;
    } catch (error) {
      if (isTrpcErrorCode(error, 'NOT_FOUND')) return null;
      throw error;
    }
  };

  /**
   * One page of the knowledge-item list; `cursor` is the raw window start
   * (`undefined` = head page), which the next request continues from.
   */
  #fetchFileListPage = async (
    params: FileListParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<FileListItem, number>> => {
    const { pageSize, ...filters } = params;
    const offset = cursor ?? 0;
    const response = await serverFileService.getKnowledgeItems({
      ...filters,
      includeContentPreview: filters.includeContentPreview ?? false,
      limit: pageSize,
      offset,
    });

    return {
      items: response.items,
      // The endpoint pages by row offset, reports `hasMore` rather than a total,
      // and drops rows *after* paging (Inbox folders), so `items.length` counts
      // visible rows while the next window starts at a raw offset. Carry the raw
      // offset forward — the whole server window was consumed, filtered or not —
      // and let exhaustion be exactly the server's `hasMore`. Anything derived
      // from `items.length` would both stall on a filtered page and keep
      // "load more" alive past the end of the list.
      nextCursor: response.hasMore ? offset + pageSize : null,
    };
  };

  #buildOptimisticUploadResource = (
    file: File,
    result: { id: string; url: string },
    knowledgeBaseId?: string,
    parentId?: string,
    visibility?: 'private' | 'public',
  ): ResourceItem => {
    const existing = this.#get().resourceMap.get(result.id);

    return {
      ...(existing || {
        createdAt: new Date(),
        fileType: file.type || 'application/octet-stream',
        name: file.name,
        size: file.size,
        sourceType: 'file' as const,
      }),
      _optimistic: undefined,
      id: result.id,
      knowledgeBaseId,
      name: file.name,
      parentId,
      size: file.size,
      updatedAt: new Date(),
      url: result.url,
      // Server persists the final visibility, but the row can be listed before
      // the refetch lands. Carry the user's picker choice so the lock badge is
      // consistent while the request is in flight.
      ...(visibility !== undefined ? { visibility } : {}),
    };
  };

  #insertOptimisticUpload = (
    id: string,
    file: File,
    knowledgeBaseId?: string,
    parentId?: string,
    visibility?: 'private' | 'public',
  ) => {
    this.#get().insertLocalResource(
      {
        fileType: file.type || 'application/octet-stream',
        knowledgeBaseId,
        name: file.name,
        parentId,
        size: file.size,
        sourceType: 'file',
        url: '',
        ...(visibility !== undefined ? { visibility } : {}),
      },
      id,
    );
  };

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

  cancelUploads = (ids: string[]): void => {
    if (ids.length === 0) return;

    const { dockUploadFileList, dispatchDockFileList } = this.#get();
    const cancellableIds = new Set(ids);
    const cancelledIds: string[] = [];

    for (const uploadItem of dockUploadFileList) {
      if (!cancellableIds.has(uploadItem.id)) continue;

      uploadItem.abortController?.abort();
      cancelledIds.push(uploadItem.id);
    }

    if (cancelledIds.length === 0) return;

    dispatchDockFileList({
      ids: cancelledIds,
      status: 'cancelled',
      type: 'updateFileStatuses',
    });
  };

  retryDockUpload = async (id: string): Promise<void> => {
    const { dispatchDockFileList, dockUploadFileList } = this.#get();
    const item = dockUploadFileList.find((file) => file.id === id);
    if (!item || item.status !== 'error' || item.errorCode) return;

    const abortController = new AbortController();
    dispatchDockFileList({
      id,
      type: 'updateFile',
      value: {
        abortController,
        error: undefined,
        errorCode: undefined,
        status: 'pending',
        uploadState: undefined,
      },
    });

    try {
      const result = await this.#get().uploadWithProgress({
        abortController,
        file: item.file,
        knowledgeBaseId: item.knowledgeBaseId,
        onStatusUpdate: dispatchDockFileList,
        parentId: item.parentId,
        uploadId: id,
        visibility: item.visibility,
      });

      if (!result) return;
      await this.#get().refreshFileList({ revalidateResources: true });

      if (isChunkingSupported({ fileType: item.file.type, name: item.file.name })) {
        await this.#get().parseFilesToChunks([result.id], { skipExist: false });
      }
    } catch (error) {
      console.error(error);
      dispatchDockFileList({
        id,
        type: 'updateFile',
        value: { error: t('upload.uploadFailed', { ns: 'error' }), status: 'error' },
      });
    }
  };

  dispatchDockFileList = (payload: UploadFileListDispatch): void => {
    const nextValue = uploadFileListReducer(this.#get().dockUploadFileList, payload);
    if (nextValue === this.#get().dockUploadFileList) return;

    this.#set({ dockUploadFileList: nextValue }, false, `dispatchDockFileList/${payload.type}`);
  };

  embeddingChunks = async (fileIds: string[]): Promise<void> => {
    const chunkTargetIds = await this.#resolveChunkTargetIds(fileIds);
    // toggle file ids
    this.#get().toggleEmbeddingIds(chunkTargetIds);

    // parse files
    const pools = chunkTargetIds.map(async (id) => {
      try {
        await ragService.createEmbeddingChunksTask(id);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    await this.#get().refreshFileList();
    this.#get().toggleEmbeddingIds(chunkTargetIds, false);
  };

  /**
   * Append the next page of the knowledge-item list. The engine reads the loaded
   * head params and de-dupes by id, so a shifted offset never repeats a row.
   */
  loadMoreKnowledgeItems = async (): Promise<void> => {
    await this.#fileList.loadMore(FILE_LIST_KEY);
  };

  moveFileToFolder = async (fileId: string, parentId: string | null): Promise<void> => {
    // Move optimistically in every loaded list / detail, then confirm from the server.
    await this.#fileEntity.optimistic(
      fileId,
      (item) => ({ ...item, parentId }),
      () => fileService.updateFile(fileId, { parentId }),
    );

    await this.#get().refreshFileList();
  };

  parseFilesToChunks = async (ids: string[], params?: { skipExist?: boolean }): Promise<void> => {
    const chunkTargetIds = await this.#resolveChunkTargetIds(ids);
    // toggle file ids
    this.#get().toggleParsingIds(chunkTargetIds);

    // parse files
    const pools = chunkTargetIds.map(async (id) => {
      try {
        await ragService.createParseFileTask(id, params?.skipExist);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    await this.#get().refreshFileList();
    this.#get().toggleParsingIds(chunkTargetIds, false);
  };

  pushDockFileList = async (
    rawFiles: File[],
    knowledgeBaseId?: string,
    parentId?: string,
    visibility?: 'private' | 'public',
  ): Promise<void> => {
    const { dispatchDockFileList } = this.#get();
    const generateUploadId = createNanoId(12);

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
        id: `upload_${generateUploadId()}`,
        knowledgeBaseId,
        parentId,
        status: 'pending' as const,
        visibility,
      };
    });

    for (const uploadFile of uploadFiles) {
      this.#insertOptimisticUpload(
        uploadFile.id,
        uploadFile.file,
        knowledgeBaseId,
        parentId,
        visibility,
      );
    }

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
          uploadId: uploadFileItem.id,
          visibility,
        });

        if (!result) {
          this.#get().removeLocalResource(uploadFileItem.id);
        } else {
          this.#get().replaceLocalResource(
            uploadFileItem.id,
            this.#buildOptimisticUploadResource(
              uploadFileItem.file,
              result,
              knowledgeBaseId,
              parentId,
              visibility,
            ),
          );
        }

        return {
          file: uploadFileItem.file,
          fileId: result?.id,
          fileType: uploadFileItem.file.type,
        };
      },
      { concurrency: MAX_UPLOAD_FILE_COUNT },
    ).catch((error) => {
      for (const uploadFile of uploadFiles) {
        this.#get().removeLocalResource(uploadFile.id);
      }

      throw error;
    });

    // 5. auto-embed files that support chunking
    const fileIdsToEmbed = uploadResults
      .filter(
        ({ file, fileId }) =>
          fileId && isChunkingSupported({ fileType: file.type, name: file.name }),
      )
      .map(({ fileId }) => fileId!);

    if (fileIdsToEmbed.length > 0) {
      await this.#get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
    }
  };

  reEmbeddingChunks = async (id: string): Promise<void> => {
    const chunkTargetId = await this.#resolveChunkTargetId(id);
    if (fileManagerSelectors.isCreatingChunkEmbeddingTask(chunkTargetId)(this.#get())) return;

    // toggle file ids
    this.#get().toggleEmbeddingIds([chunkTargetId]);

    await serverFileService.removeFileAsyncTask(chunkTargetId, 'embedding');

    await this.#get().refreshFileList();

    await ragService.createEmbeddingChunksTask(chunkTargetId);

    await this.#get().refreshFileList();

    this.#get().toggleEmbeddingIds([chunkTargetId], false);
  };

  reParseFile = async (id: string): Promise<void> => {
    const chunkTargetId = await this.#resolveChunkTargetId(id);
    // toggle file ids
    this.#get().toggleParsingIds([chunkTargetId]);

    await ragService.retryParseFile(chunkTargetId);

    await this.#get().refreshFileList();

    this.#get().toggleParsingIds([chunkTargetId], false);
  };

  refreshFileList = async (options?: RefreshFileListOptions): Promise<void> => {
    await this.#fileList.revalidate();

    if (options?.revalidateResources === false) return;

    const { revalidateResources } = await import('../resource/hooks');
    await revalidateResources();
  };

  publishFileToWorkspace = async (id: string): Promise<void> => {
    await fileService.publishFileToWorkspace(id);
    this.#fileEntity.update(id, (item) => ({ ...item, visibility: 'public' }));
    await this.#get().refreshFileList();
  };

  setFileVisibility = async (id: string, visibility: 'private' | 'public'): Promise<void> => {
    await fileService.setFileVisibility(id, visibility);
    this.#fileEntity.update(id, (item) => ({ ...item, visibility }));
    await this.#get().refreshFileList();
  };

  removeFileItem = async (id: string): Promise<void> => {
    await fileService.removeFile(id);
    // Drop it from every loaded list / detail at once, then confirm from the server.
    this.#fileEntity.remove(id);
    await this.#get().refreshFileList();
  };

  removeFiles = async (ids: string[]): Promise<void> => {
    await fileService.removeFiles(ids);
    for (const id of ids) this.#fileEntity.remove(id);
    await this.#get().refreshFileList();
  };

  /**
   * Drop cached knowledge items without calling the server, for a deletion that
   * was already confirmed elsewhere (the resource explorer has its own delete
   * paths). Both of this slice's replicas persist by id, so leaving a deleted
   * row behind lets a later direct visit repaint it until a NOT_FOUND answer
   * arrives — and offline that answer never comes. Evicts the list row and every
   * loaded detail together, exactly like a local delete.
   */
  forgetKnowledgeItems = (ids: string[]): void => {
    for (const id of ids) this.#fileEntity.remove(id);
  };

  renameFolder = async (folderId: string, newName: string): Promise<void> => {
    // Rename optimistically in every loaded list / detail, then confirm from the server.
    await this.#fileEntity.optimistic(
      folderId,
      (item) => ({ ...item, name: newName }),
      () => documentService.updateDocument({ id: folderId, title: newName }),
    );

    await this.#get().refreshFileList();
  };

  setCurrentFolderId = (folderId: string | null | undefined): void => {
    this.#set({ currentFolderId: folderId }, false, 'setCurrentFolderId');
  };

  setPendingRenameItemId = (id: string | null): void => {
    this.#set({ pendingRenameItemId: id }, false, 'setPendingRenameItemId');
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
    const generateUploadId = createNanoId(12);

    // 1. Build folder tree from file paths
    const { filesByFolder, folders } = buildFolderTree(files);

    // 2. Sort folders by depth to ensure parents are created before children
    const sortedFolderPaths = topologicalSortFolders(folders);

    // Show toast notification if there are folders to create
    let creatingFoldersToast: ToastInstance | undefined;
    if (sortedFolderPaths.length > 0) {
      creatingFoldersToast = toast.loading({
        duration: Infinity, // Don't auto-dismiss
        title: t('header.actions.uploadFolder.creatingFolders', { ns: 'file' }),
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
      creatingFoldersToast?.close();

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

      const uploadItems = validUploads.map(({ file, parentId }) => ({
        abortController: new AbortController(),
        file,
        id: `upload_${generateUploadId()}`,
        parentId,
        shouldShowInCurrentList: (parentId ?? undefined) === currentFolderId,
      }));

      // 7. Add all files to dock
      dispatchDockFileList({
        atStart: true,
        files: uploadItems.map(({ abortController, file, id, parentId }) => ({
          abortController,
          file,
          id,
          knowledgeBaseId,
          parentId,
          status: 'pending' as const,
        })),
        type: 'addFiles',
      });

      for (const uploadItem of uploadItems) {
        if (!uploadItem.shouldShowInCurrentList) continue;

        this.#insertOptimisticUpload(
          uploadItem.id,
          uploadItem.file,
          knowledgeBaseId,
          uploadItem.parentId,
        );
      }

      // 8. Upload files with concurrency limit
      const uploadResults = await pMap(
        uploadItems,
        async ({ abortController, file, id, parentId, shouldShowInCurrentList }) => {
          const result = await this.#get().uploadWithProgress({
            abortController,
            file,
            knowledgeBaseId,
            onStatusUpdate: dispatchDockFileList,
            parentId,
            uploadId: id,
          });

          if (shouldShowInCurrentList) {
            if (!result) {
              this.#get().removeLocalResource(id);
            } else {
              this.#get().replaceLocalResource(
                id,
                this.#buildOptimisticUploadResource(file, result, knowledgeBaseId, parentId),
              );
            }
          }

          return { file, fileId: result?.id, fileType: file.type };
        },
        { concurrency: MAX_UPLOAD_FILE_COUNT },
      ).catch((error) => {
        for (const uploadItem of uploadItems) {
          if (!uploadItem.shouldShowInCurrentList) continue;
          this.#get().removeLocalResource(uploadItem.id);
        }

        throw error;
      });

      // 9. Auto-embed files that support chunking
      const fileIdsToEmbed = uploadResults
        .filter(
          ({ file, fileId }) =>
            fileId && isChunkingSupported({ fileType: file.type, name: file.name }),
        )
        .map(({ fileId }) => fileId!);

      if (fileIdsToEmbed.length > 0) {
        await this.#get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
      }
    } catch (error) {
      // Dismiss toast on error
      creatingFoldersToast?.close();
      throw error;
    }
  };

  /**
   * Fetch orchestration for a folder's ancestor chain. Hydrates the persisted
   * projection, then revalidates; the chain lands in `folderBreadcrumbMap` and
   * this hook returns it for the breadcrumb surfaces.
   */
  useFetchFolderBreadcrumb = (slug?: string | null): UseFetchFolderBreadcrumbResult => {
    const entry = useFileStore((s) => (slug ? s.folderBreadcrumbMap[slug] : undefined));
    const sync = this.#folderBreadcrumb.useSync(slug ?? null);

    return {
      data: entry ?? EMPTY_CRUMBS,
      error: sync.error,
      isLoading: Boolean(slug) && entry === undefined && sync.error == null,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    };
  };

  /**
   * Sync one knowledge item through its replica. The view is the source of
   * truth, so a reload or a return to the route paints from the persisted
   * projection on the first frame and the network only confirms it.
   *
   * Keeps SWR's `{ data, error, isLoading, mutate }` shape for its callers while
   * reading `data` from the store view — a "not found" answer reads as `undefined`.
   */
  useFetchKnowledgeItem = (id?: string): UseFetchKnowledgeItemResult => {
    const entry = useFileStore((s) => (id ? s.fileDetailMap[id] : undefined));
    const sync = this.#fileDetail.useSync(id ?? null);

    return {
      data: entry?.file ?? undefined,
      error: sync.error,
      isLoading: Boolean(id) && entry === undefined && sync.error == null,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    };
  };

  /**
   * Fetch orchestration for the knowledge-item list. Hydrates the persisted head
   * page, then revalidates; the rows land in `fileList` — read them from the
   * store, never from this hook.
   */
  useFetchKnowledgeItems = (params: QueryFileListParams): ReplicaSyncResult => {
    const { limit, offset, ...filters } = params;
    void offset;
    return this.#fileList.useSync({
      ...filters,
      pageSize: limit ?? DEFAULT_FILE_LIST_PAGE_SIZE,
    } satisfies FileListParams);
  };
}

export type FileManageAction = Pick<FileManageActionImpl, keyof FileManageActionImpl>;
