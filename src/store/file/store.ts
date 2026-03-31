import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import type { FilesStoreState } from './initialState';
import { initialState } from './initialState';
import type { FileAction } from './slices/chat';
import { createFileSlice } from './slices/chat';
import type { FileChunkAction } from './slices/chunk';
import { createFileChunkSlice } from './slices/chunk';
import type { DocumentAction } from './slices/document';
import { createDocumentSlice } from './slices/document';
import type { FileManageAction } from './slices/fileManager';
import { createFileManageSlice } from './slices/fileManager';
import type { ResourceAction } from './slices/resource/action';
import { ResourceActionImpl } from './slices/resource/action';
import type { TTSFileAction } from './slices/tts';
import { createTTSFileSlice } from './slices/tts';
import type { FileUploadAction } from './slices/upload/action';
import { createFileUploadSlice } from './slices/upload/action';

//  ===============  Aggregate createStoreFn ============ //

export interface FileStore
  extends
    FileAction,
    DocumentAction,
    TTSFileAction,
    FileManageAction,
    FileChunkAction,
    FileUploadAction,
    ResourceAction,
    FilesStoreState {}

type FileStoreAction = FileAction &
  DocumentAction &
  TTSFileAction &
  FileManageAction &
  FileChunkAction &
  FileUploadAction &
  ResourceAction;

const createStore: StateCreator<FileStore, [['zustand/devtools', never]]> = (
  ...params: Parameters<StateCreator<FileStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<FileStoreAction>([
    createFileSlice(...params),
    createDocumentSlice(...params),
    createFileManageSlice(...params),
    createTTSFileSlice(...params),
    createFileChunkSlice(...params),
    createFileUploadSlice(...params),
    new ResourceActionImpl(...params),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('file');

export const useFileStore = createWithEqualityFn<FileStore>()(devtools(createStore), shallow);

expose('file', useFileStore);

export const getFileStoreState = () => useFileStore.getState();
