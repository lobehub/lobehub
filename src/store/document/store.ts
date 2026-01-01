import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type EditorAction, type EditorState, createEditorSlice, initialEditorState } from './slices/editor';
import {
  type NotebookAction,
  type NotebookState,
  createNotebookSlice,
  initialNotebookState,
} from './slices/notebook';

// Combined state type
export type DocumentState = EditorState & NotebookState;

// Combined action type
export type DocumentAction = EditorAction & NotebookAction;

// Full store type
export type DocumentStore = DocumentState & DocumentAction;

// Initial state
const initialState: DocumentState = {
  ...initialEditorState,
  ...initialNotebookState,
};

const createStore: StateCreator<DocumentStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialState,
  ...createEditorSlice(...parameters),
  ...createNotebookSlice(...parameters),
});

const devtools = createDevtools('document');

export const useDocumentStore = createWithEqualityFn<DocumentStore>()(
  devtools(createStore),
  shallow,
);

export const getDocumentStoreState = () => useDocumentStore.getState();
