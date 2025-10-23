import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { ServerService } from '@/services/file/server';
import { ragService } from '@/services/rag';
import {
  UploadFileListDispatch,
  uploadFileListReducer,
} from '@/store/file/reducers/uploadFileList';
import { FileListItem, QueryFileListParams } from '@/types/files';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import { FileStore } from '../../store';
import { fileManagerSelectors } from './selectors';

const serverFileService = new ServerService();

export interface FileManageAction {
  dispatchDockFileList: (payload: UploadFileListDispatch) => void;
  embeddingChunks: (fileIds: string[]) => Promise<void>;
  parseFilesToChunks: (ids: string[], params?: { skipExist?: boolean }) => Promise<void>;
  pushDockFileList: (files: File[], knowledgeBaseId?: string) => Promise<void>;

  reEmbeddingChunks: (id: string) => Promise<void>;
  reParseFile: (id: string) => Promise<void>;
  refreshFileList: () => Promise<void>;
  removeAllFiles: () => Promise<void>;
  removeFileItem: (id: string) => Promise<void>;
  removeFiles: (ids: string[]) => Promise<void>;

  toggleEmbeddingIds: (ids: string[], loading?: boolean) => void;
  toggleParsingIds: (ids: string[], loading?: boolean) => void;

  useFetchFileItem: (id?: string) => SWRResponse<FileListItem | undefined>;
  useFetchFileManage: (params: QueryFileListParams) => SWRResponse<FileListItem[]>;
}

const FETCH_FILE_LIST_KEY = 'useFetchFileManage';

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
  pushDockFileList: async (rawFiles, knowledgeBaseId) => {
    const { dispatchDockFileList } = get();

    // 0. skip file in blacklist
    const files = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));

    // 1. add files
    dispatchDockFileList({
      atStart: true,
      files: files.map((file) => ({ file, id: file.name, status: 'pending' })),
      type: 'addFiles',
    });

    const uploadResults = await Promise.all(
      files.map(async (file) => {
        const result = await get().uploadWithProgress({
          file,
          knowledgeBaseId,
          onStatusUpdate: dispatchDockFileList,
        });

        await get().refreshFileList();

        return { file, fileId: result?.id, fileType: file.type };
      }),
    );

    // 2. auto-embed files that support chunking
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
    await mutate([FETCH_FILE_LIST_KEY, get().queryListParams]);
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

  useFetchFileItem: (id) =>
    useClientDataSWR<FileListItem | undefined>(!id ? null : ['useFetchFileItem', id], () =>
      serverFileService.getFileItem(id!),
    ),

  useFetchFileManage: (params) =>
    useClientDataSWR<FileListItem[]>(
      [FETCH_FILE_LIST_KEY, params],
      () => serverFileService.getFiles(params),
      {
        onSuccess: (data) => {
          set({ fileList: data, queryListParams: params });
        },
      },
    ),
});
