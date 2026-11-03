import { type ImageFileState } from './slices/chat';
import { initialImageFileState } from './slices/chat';
import { type FileChunkState } from './slices/chunk';
import { initialFileChunkState } from './slices/chunk';
// Leaf modules on purpose: the slice barrel also pulls in `action.ts`, which
// imports this store back — reaching it from here would close the cycle before
// the store is initialized.
import { type DocumentState } from './slices/document/initialState';
import { initialDocumentState } from './slices/document/initialState';
import { type FileManagerState } from './slices/fileManager/initialState';
import { initialFileManagerState } from './slices/fileManager/initialState';
import { type ResourceState } from './slices/resource/initialState';
import { initialResourceState } from './slices/resource/initialState';

export type FilesStoreState = ImageFileState &
  DocumentState &
  FileManagerState &
  FileChunkState &
  ResourceState;

export const initialState: FilesStoreState = {
  ...initialImageFileState,
  ...initialDocumentState,
  ...initialFileManagerState,
  ...initialFileChunkState,
  ...initialResourceState,
};
