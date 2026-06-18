import { type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { fileKeys } from '@/libs/swr/keys';
import { fileService } from '@/services/file';
import { type StoreSetter } from '@/store/types';
import { type FileItem } from '@/types/files';

import { type FileStore } from '../../store';

type Setter = StoreSetter<FileStore>;
export const createTTSFileSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new TTSFileActionImpl(set, get, _api);

export class TTSFileActionImpl {
  readonly #get: () => FileStore;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  removeTTSFile = async (id: string): Promise<void> => {
    await fileService.removeFile(id);
  };

  uploadTTSByArrayBuffers = async (
    messageId: string,
    arrayBuffers: ArrayBuffer[],
  ): Promise<string | undefined> => {
    const fileType = 'audio/mp3';
    const blob = new Blob(arrayBuffers, { type: fileType });
    const fileName = `${messageId}.mp3`;
    const fileOptions = {
      lastModified: Date.now(),
      type: fileType,
    };
    const file = new File([blob], fileName, fileOptions);

    const res = await this.#get().uploadWithProgress({ file, skipCheckFileType: true });

    return res?.id;
  };

  useFetchTTSFile = (id: string | null): SWRResponse<FileItem> => {
    return useClientDataSWR(!!id ? fileKeys.ttsFile(id) : null, () => fileService.getFile(id!));
  };
}

export type TTSFileAction = Pick<TTSFileActionImpl, keyof TTSFileActionImpl>;
