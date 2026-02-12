import { type StateCreator } from 'zustand/vanilla';

import { type KnowledgeBaseStore } from '@/store/library/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type RAGEvalDatasetAction } from './dataset';
import { createRagEvalDatasetSlice } from './dataset';
import { type RAGEvalEvaluationAction } from './evaluation';
import { createRagEvalEvaluationSlice } from './evaluation';

export type RAGEvalAction = RAGEvalDatasetAction & RAGEvalEvaluationAction;

export const createRagEvalSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  RAGEvalAction
> = (
  ...params: Parameters<
    StateCreator<KnowledgeBaseStore, [['zustand/devtools', never]], [], RAGEvalAction>
  >
) =>
  flattenActions<RAGEvalAction>([
    createRagEvalDatasetSlice(...params),
    createRagEvalEvaluationSlice(...params),
  ]);
