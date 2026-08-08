import { type ChatContextContent } from '@lobechat/types';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { toast } from '@lobehub/ui/base-ui';
import { Buffer } from 'buffer.js';
import { t } from 'i18next';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { UPLOAD_NETWORK_ERROR } from '@/services/upload';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type UploadFileItem } from '@/types/files/upload';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore } from '../../store';
import { filterSupportedChatUploadFiles } from './uploadGuard';

const n = setNamespace('chat');

type Setter = StoreSetter<FileStore>;
export const createFileSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileActionImpl(set, get, _api);

const getTrpcErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('data' in error)) return;

  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === 'string' ? data.code : undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return String(error);
};

const getUploadErrorDescription = (error: unknown): string => {
  if (error === UPLOAD_NETWORK_ERROR) return t('upload.networkError', { ns: 'error' });

  if (getTrpcErrorCode(error) === 'FORBIDDEN') {
    return t('upload.permissionDenied', { ns: 'error' });
  }

  return typeof error === 'string'
    ? error
    : t('upload.unknownError', { ns: 'error', reason: getErrorMessage(error) });
};

export class FileActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addChatContextSelection = ({
    contextKey,
    selection,
  }: {
    contextKey: string;
    selection: ChatContextContent;
  }): void => {
    const currentMap = this.#get().chatContextSelectionsByContext;
    const current = currentMap[contextKey] ?? [];
    const next = [selection, ...current.filter((item) => item.id !== selection.id)];

    this.#set(
      { chatContextSelectionsByContext: { ...currentMap, [contextKey]: next } },
      false,
      n('addChatContextSelection'),
    );
  };

  clearChatContextSelections = (contextKey: string): void => {
    const currentMap = this.#get().chatContextSelectionsByContext;
    if (!(contextKey in currentMap)) return;

    const { [contextKey]: _removed, ...nextMap } = currentMap;
    this.#set({ chatContextSelectionsByContext: nextMap }, false, n('clearChatContextSelections'));
  };

  clearChatUploadFileList = (): void => {
    this.#set({ chatUploadFileList: [] }, false, n('clearChatUploadFileList'));
  };

  dispatchChatUploadFileList = (payload: UploadFileListDispatch): void => {
    const nextValue = uploadFileListReducer(this.#get().chatUploadFileList, payload);
    if (nextValue === this.#get().chatUploadFileList) return;

    this.#set({ chatUploadFileList: nextValue }, false, `dispatchChatFileList/${payload.type}`);
  };

  moveChatContextSelections = (fromContextKey: string, toContextKey: string): void => {
    if (fromContextKey === toContextKey) return;

    const currentMap = this.#get().chatContextSelectionsByContext;
    const source = currentMap[fromContextKey];
    if (!source || source.length === 0) return;

    const sourceIds = new Set(source.map((item) => item.id));
    const target = currentMap[toContextKey] ?? [];
    const nextTarget = [...source, ...target.filter((item) => !sourceIds.has(item.id))];
    const { [fromContextKey]: _removed, ...nextMap } = currentMap;

    this.#set(
      { chatContextSelectionsByContext: { ...nextMap, [toContextKey]: nextTarget } },
      false,
      n('moveChatContextSelections'),
    );
  };

  removeChatContextSelection = ({ contextKey, id }: { contextKey: string; id: string }): void => {
    const currentMap = this.#get().chatContextSelectionsByContext;
    const current = currentMap[contextKey];
    if (!current) return;

    const next = current.filter((item) => item.id !== id);
    if (next.length === 0) {
      const { [contextKey]: _removed, ...nextMap } = currentMap;
      this.#set(
        { chatContextSelectionsByContext: nextMap },
        false,
        n('removeChatContextSelection'),
      );
      return;
    }

    this.#set(
      { chatContextSelectionsByContext: { ...currentMap, [contextKey]: next } },
      false,
      n('removeChatContextSelection'),
    );
  };

  restoreChatContextSelections = (contextKey: string, selections: ChatContextContent[]): void => {
    if (selections.length === 0) return;

    const currentMap = this.#get().chatContextSelectionsByContext;
    const restoredIds = new Set(selections.map((item) => item.id));
    const current = currentMap[contextKey] ?? [];
    const next = [...selections, ...current.filter((item) => !restoredIds.has(item.id))];

    this.#set(
      { chatContextSelectionsByContext: { ...currentMap, [contextKey]: next } },
      false,
      n('restoreChatContextSelections'),
    );
  };

  removeChatUploadFile = async (id: string): Promise<void> => {
    const { chatUploadFileList, dispatchChatUploadFileList } = this.#get();

    // Restored entries reference an already-persisted file that still backs the
    // original message — only drop the draft item, never delete the file itself.
    const skipRemoveFile = chatUploadFileList.find((item) => item.id === id)?.skipRemoveFile;

    dispatchChatUploadFileList({ id, type: 'removeFile' });

    if (skipRemoveFile) return;

    await fileService.removeFile(id);
  };

  retryChatUploadFile = async (id: string): Promise<void> => {
    const { chatUploadFileList, dispatchChatUploadFileList } = this.#get();
    const item = chatUploadFileList.find((file) => file.id === id);
    if (!item?.agentId) return;

    dispatchChatUploadFileList({ id, type: 'removeFile' });
    await this.uploadChatFiles([item.file], item.agentId);
  };

  startAsyncTask = async (
    id: string,
    runner: (id: string) => Promise<string>,
    onFileItemUpdate: (fileItem: FileListItem) => void,
  ): Promise<void> => {
    await runner(id);

    let isFinished = false;

    while (!isFinished) {
      // Poll task status every 2 seconds
      await sleep(2000);

      let fileItem: FileListItem | undefined;

      try {
        const result = await fileService.getKnowledgeItem(id);
        fileItem = result ?? undefined;
      } catch (e) {
        console.error('getFileItem Error:', e);
        continue;
      }

      if (!fileItem) return;

      onFileItemUpdate(fileItem);

      if (fileItem.finishEmbedding) {
        isFinished = true;
      }

      // if error, also break
      else if (fileItem.chunkingStatus === 'error' || fileItem.embeddingStatus === 'error') {
        isFinished = true;
      }
    }
  };

  uploadChatFiles = async (rawFiles: File[], agentId: string): Promise<void> => {
    const { dispatchChatUploadFileList } = this.#get();
    // 0. skip file in blacklist
    const filteredFiles = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));

    // The file-type whitelist only makes sense in plain chat mode, where files are fed
    // directly to the model. In agent mode (tool calls) or heterogeneous agents (Claude
    // Code / Codex, etc.) the agent can parse any file via scripts/terminal, so the
    // whitelist must not apply there. We key off the conversation's own agent id rather
    // than the global current agent, because the chat input can be scoped to a different
    // agent than activeAgentId (e.g. another desktop tab). See lobehub/lobehub#15770.
    const agentState = getAgentStoreState();
    const enforceFileTypeWhitelist =
      !agentByIdSelectors.getAgentEnableModeById(agentId)(agentState) &&
      !agentByIdSelectors.isAgentHeterogeneousById(agentId)(agentState);

    const { supportedFiles, unsupportedFiles } = enforceFileTypeWhitelist
      ? filterSupportedChatUploadFiles(filteredFiles)
      : { supportedFiles: filteredFiles, unsupportedFiles: [] as File[] };

    if (unsupportedFiles.length > 0) {
      toast.error(
        t('upload.validation.unsupportedFileType', {
          files: unsupportedFiles.map((file) => file.name).join(', '),
          ns: 'chat',
        }),
      );
    }

    if (supportedFiles.length === 0) return;

    // 1. compress images and add files with base64
    const files = await Promise.all(
      supportedFiles.map((file) =>
        COMPRESSIBLE_IMAGE_TYPES.has(file.type) ? compressImageFile(file) : file,
      ),
    );

    const uploadFiles: UploadFileItem[] = await Promise.all(
      files.map(async (file) => {
        let previewUrl: string | undefined = undefined;
        let base64Url: string | undefined = undefined;

        // only image and video can be previewed, we create a previewUrl and base64Url for them
        if (file.type.startsWith('image') || file.type.startsWith('video')) {
          const data = await file.arrayBuffer();

          previewUrl = URL.createObjectURL(new Blob([data!], { type: file.type }));

          const base64 = Buffer.from(data!).toString('base64');
          base64Url = `data:${file.type};base64,${base64}`;
        }

        return {
          agentId,
          base64Url,
          file,
          id: file.name,
          previewUrl,
          status: 'pending',
        } as UploadFileItem;
      }),
    );

    dispatchChatUploadFileList({ files: uploadFiles, type: 'addFiles' });

    // upload files and process it
    const pools = files.map(async (file) => {
      let fileResult: { id: string; url: string } | undefined;

      try {
        fileResult = await this.#get().uploadWithProgress({
          file,
          onStatusUpdate: dispatchChatUploadFileList,
        });
      } catch (error) {
        if (getErrorMessage(error) === 'UNAUTHORIZED') {
          dispatchChatUploadFileList({ id: file.name, type: 'removeFile' });
        } else {
          dispatchChatUploadFileList({
            id: file.name,
            type: 'updateFile',
            value: {
              error: getUploadErrorDescription(error),
              status: 'error',
              uploadState: undefined,
            },
          });
        }
      }

      if (!fileResult) return;

      // image don't need to be chunked and embedding
      if (isChunkingUnsupported(file.type)) return;

      await ragService.parseFileContent(fileResult.id);
    });

    await Promise.all(pools);
  };
}

export type FileAction = Pick<FileActionImpl, keyof FileActionImpl>;
