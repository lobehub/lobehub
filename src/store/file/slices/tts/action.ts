import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { type FileItem } from '@/types/files';

import { type FileStore } from '../../store';

const FETCH_TTS_FILE = 'fetchTTSFile';

export interface TTSFileAction {
  removeTTSFile: (id: string) => Promise<void>;

  uploadTTSByArrayBuffers: (
    messageId: string,
    arrayBuffers: ArrayBuffer[],
  ) => Promise<string | undefined>;

  useFetchTTSFile: (id: string | null) => SWRResponse<FileItem>;
}

export const createTTSFileSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  TTSFileAction
> = (_, get) => ({
  removeTTSFile: async (id) => {
    await fileService.removeFile(id);
  },
  uploadTTSByArrayBuffers: async (messageId, arrayBuffers) => {
    const fileType = 'audio/mp3';
    const blob = new Blob(arrayBuffers, { type: fileType });
    const fileName = `${messageId}.mp3`;
    const fileOptions = {
      lastModified: Date.now(),
      type: fileType,
    };
    const file = new File([blob], fileName, fileOptions);

    const res = await get().uploadWithProgress({ file, skipCheckFileType: true });

    return res?.id;
  },
  useFetchTTSFile: (id) =>
    useClientDataSWR(!!id ? [FETCH_TTS_FILE, id] : null, () => fileService.getFile(id!)),
});
