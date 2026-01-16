import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type KnowledgeBaseStoreState, initialState } from './initialState';
import { type KnowledgeBaseContentAction, createContentSlice } from './slices/content';
import { type KnowledgeBaseCrudAction, createCrudSlice } from './slices/crud';
import { type RAGEvalAction, createRagEvalSlice } from './slices/ragEval';

//  ===============  Aggregate createStoreFn ============ //

export interface KnowledgeBaseStore
  extends KnowledgeBaseStoreState,
    KnowledgeBaseCrudAction,
    KnowledgeBaseContentAction,
    RAGEvalAction {
  // empty
}

const createStore: StateCreator<KnowledgeBaseStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialState,
  ...createCrudSlice(...parameters),
  ...createContentSlice(...parameters),
  ...createRagEvalSlice(...parameters),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('knowledgeBase');

export const useKnowledgeBaseStore = createWithEqualityFn<KnowledgeBaseStore>()(
  devtools(createStore),
  shallow,
);
