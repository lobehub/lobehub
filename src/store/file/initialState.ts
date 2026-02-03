import { type ImageFileState, initialImageFileState } from './slices/chat';
import { type FileChunkState, initialFileChunkState } from './slices/chunk';
import { type DocumentState, initialDocumentState } from './slices/document';
import { type FileManagerState, initialFileManagerState } from './slices/fileManager';
import { type ResourceState, initialResourceState } from './slices/resource/initialState';

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
