import { type StateCreator } from 'zustand/vanilla';

import { type KnowledgeBaseStore } from '@/store/knowledgeBase/store';

import { type RAGEvalDatasetAction, createRagEvalDatasetSlice } from './dataset';
import { type RAGEvalEvaluationAction, createRagEvalEvaluationSlice } from './evaluation';

export interface RAGEvalAction extends RAGEvalDatasetAction, RAGEvalEvaluationAction {
  // empty
}

export const createRagEvalSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  RAGEvalAction
> = (...params) => ({
  ...createRagEvalDatasetSlice(...params),
  ...createRagEvalEvaluationSlice(...params),
});
