import { type ChatContextContent } from '@lobechat/types';
import { t } from 'i18next';

import { notification } from '@/components/AntdStaticMethods';
import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { UPLOAD_NETWORK_ERROR } from '@/services/upload';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type UploadFileItem } from '@/types/files/upload';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore } from '../../store';

const n = setNamespace('chat');

type Setter = StoreSetter<FileStore>;
export const createFileSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileActionImpl(set, get, _api);

export class FileActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addChatContextSelection = (context: ChatContextContent): void => {
    const current = this.#get().chatContextSelections;
    const next = [context, ...current.filter((item) => item.id !== context.id)];

    this.#set({ chatContextSelections: next }, false, n('addChatContextSelection'));
  };

  clearChatContextSelections = (): void => {
    this.#set({ chatContextSelections: [] }, false, n('clearChatContextSelections'));
  };

  clearChatUploadFileList = (): void => {
    this.#set({ chatUploadFileList: [] }, false, n('clearChatUploadFileList'));
  };

  dispatchChatUploadFileList = (payload: UploadFileListDispatch): void => {
    const nextValue = uploadFileListReducer(this.#get().chatUploadFileList, payload);
    if (nextValue === this.#get().chatUploadFileList) return;

    this.#set({ chatUploadFileList: nextValue }, false, `dispatchChatFileList/${payload.type}`);
  };

  removeChatContextSelection = (id: string): void => {
    const next = this.#get().chatContextSelections.filter((item) => item.id !== id);
    this.#set({ chatContextSelections: next }, false, n('removeChatContextSelection'));
  };

  removeChatUploadFile = async (id: string): Promise<void> => {
    const { dispatchChatUploadFileList } = this.#get();

    dispatchChatUploadFileList({ id, type: 'removeFile' });
    await fileService.removeFile(id);
  };

  startAsyncTask = async (
    id: string,
    runner: (id: string) => Promise<string>,
    onFileItemUpdate: (fileItem: FileListItem) => void,
  ): Promise<void> => {
    await runner(id);

    let isFinished = false;

    while (!isFinished) {
      // 每间隔 2s 查询一次任务状态
      await sleep(2000);

      let fileItem: FileListItem | undefined = undefined;

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

  uploadChatFiles = async (rawFiles: File[]): Promise<void> => {
    const { dispatchChatUploadFileList } = this.#get();
    // 0. skip file in blacklist
    const files = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
    // 1. add files with base64
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

        return { base64Url, file, id: file.name, previewUrl, status: 'pending' } as UploadFileItem;
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
        // skip `UNAUTHORIZED` error
        if ((error as any)?.message !== 'UNAUTHORIZED')
          notification.error({
            description:
              // it may be a network error or the cors error
              error === UPLOAD_NETWORK_ERROR
                ? t('upload.networkError', { ns: 'error' })
                : // or the error from the server
                  typeof error === 'string'
                  ? error
                  : t('upload.unknownError', { ns: 'error', reason: (error as Error).message }),
            message: t('upload.uploadFailed', { ns: 'error' }),
          });

        dispatchChatUploadFileList({ id: file.name, type: 'removeFile' });
      }

      if (!fileResult) return;

      // image don't need to be chunked and embedding
      if (isChunkingUnsupported(file.type)) return;

      const data = await ragService.parseFileContent(fileResult.id);
      console.log('parseFileContent data:', data);
    });

    await Promise.all(pools);
  };
}

export type FileAction = Pick<FileActionImpl, keyof FileActionImpl>;
