import { type KnowledgeBaseState, initialKnowledgeBaseState } from '../library/slices/crud';
import { type RAGEvalState, initialDatasetState } from '../library/slices/ragEval';

export type KnowledgeBaseStoreState = KnowledgeBaseState & RAGEvalState;

export const initialState: KnowledgeBaseStoreState = {
  ...initialKnowledgeBaseState,
  ...initialDatasetState,
};
