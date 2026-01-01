import { type KnowledgeBaseState, initialKnowledgeBaseState } from '../knowledgeBase/slices/crud';
import { type RAGEvalState, initialDatasetState } from '../knowledgeBase/slices/ragEval';

export type KnowledgeBaseStoreState = KnowledgeBaseState & RAGEvalState;

export const initialState: KnowledgeBaseStoreState = {
  ...initialKnowledgeBaseState,
  ...initialDatasetState,
};
