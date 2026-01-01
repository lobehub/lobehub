import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type FilesStoreState, initialState } from './initialState';
import { type FileAction, createFileSlice } from './slices/chat';
import { type FileChunkAction, createFileChunkSlice } from './slices/chunk';
import { type DocumentAction, createDocumentSlice } from './slices/document';
import { type FileManageAction, createFileManageSlice } from './slices/fileManager';
import { type TTSFileAction, createTTSFileSlice } from './slices/tts';
import { type FileUploadAction, createFileUploadSlice } from './slices/upload/action';

//  ===============  Aggregate createStoreFn ============ //

export type FileStore = FilesStoreState &
  FileAction &
  DocumentAction &
  TTSFileAction &
  FileManageAction &
  FileChunkAction &
  FileUploadAction;

const createStore: StateCreator<FileStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...createFileSlice(...parameters),
  ...createDocumentSlice(...parameters),
  ...createFileManageSlice(...parameters),
  ...createTTSFileSlice(...parameters),
  ...createFileChunkSlice(...parameters),
  ...createFileUploadSlice(...parameters),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('file');

export const useFileStore = createWithEqualityFn<FileStore>()(devtools(createStore), shallow);

export const getFileStoreState = () => useFileStore.getState();
