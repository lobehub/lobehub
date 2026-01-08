import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import {
  type EditorAction,
  type EditorState,
  createEditorSlice,
  initialEditorState,
} from './slices/editor';

// State type
export type DocumentState = EditorState;

// Action type
export type DocumentAction = EditorAction;

// Full store type
export type DocumentStore = DocumentState & DocumentAction;

// Initial state
const initialState: DocumentState = {
  ...initialEditorState,
};

const createStore: StateCreator<DocumentStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialState,
  ...createEditorSlice(...parameters),
});

const devtools = createDevtools('document');

export const useDocumentStore = createWithEqualityFn<DocumentStore>()(
  devtools(createStore),
  shallow,
);

export const getDocumentStoreState = () => useDocumentStore.getState();
