// Selectors
export { editorSelectors } from './slices/editor';

// Store
export type { DocumentState, DocumentStore, DocumentStoreAction } from './store';
export { getDocumentStoreState, useDocumentStore } from './store';

// Re-export document slice types
export type {
  DocumentAction,
  InitDocumentParams,
  UseFetchDocumentOptions,
} from './slices/document';

// Re-export editor slice types
export type {
  DocumentSourceType,
  EditorAction,
  EditorContentState,
  EditorState,
  SaveMetadata,
} from './slices/editor';
export { createInitialEditorContentState } from './slices/editor';
