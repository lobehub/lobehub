import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import {
  type DocumentAction,
  type DocumentDetailSliceState,
  initialDocumentDetailSliceState,
} from './slices/document';
import { createDocumentSlice } from './slices/document';
import { type EditorAction, type EditorState } from './slices/editor';
import { createEditorSlice, initialEditorState } from './slices/editor';
import {
  createDocumentHistorySlice,
  type DocumentHistoryAction,
  type DocumentHistoryState,
  initialDocumentHistoryState,
} from './slices/history';

// State type
export type DocumentState = EditorState & DocumentDetailSliceState & DocumentHistoryState;

// Action type
export type DocumentStoreAction = DocumentAction &
  DocumentHistoryAction &
  EditorAction &
  ResetableStore;

// Full store type
export type DocumentStore = DocumentState & DocumentStoreAction;

// Initial state
const initialState: DocumentState = {
  ...initialEditorState,
  ...initialDocumentDetailSliceState,
  ...initialDocumentHistoryState,
};

class DocumentStoreResetAction extends ResetableStoreAction<DocumentStore> {
  protected readonly resetActionName = 'resetDocumentStore';
}

const createStore: StateCreator<DocumentStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<DocumentStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<DocumentStoreAction>([
    createDocumentSlice(...parameters),
    createDocumentHistorySlice(...parameters),
    createEditorSlice(...parameters),
    new DocumentStoreResetAction(...parameters),
  ]),
});

const devtools = createDevtools('document');

export const useDocumentStore = createWithEqualityFn<DocumentStore>()(
  devtools(createStore),
  shallow,
);

expose('document', useDocumentStore);

export const getDocumentStoreState = () => useDocumentStore.getState();
