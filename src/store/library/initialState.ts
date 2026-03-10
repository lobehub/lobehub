import { type KnowledgeBaseState } from '../library/slices/crud';
import { initialKnowledgeBaseState } from '../library/slices/crud';
import { type RAGEvalState } from '../library/slices/ragEval';
import { initialDatasetState } from '../library/slices/ragEval';

export type KnowledgeBaseStoreState = KnowledgeBaseState & RAGEvalState;

export const initialState: KnowledgeBaseStoreState = {
  ...initialKnowledgeBaseState,
  ...initialDatasetState,
};
