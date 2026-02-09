import { type CreateNewEvalEvaluation, type RAGEvalDataSetItem } from '@lobechat/types';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { ragEvalService } from '@/services/ragEval';
import { type KnowledgeBaseStore } from '@/store/library/store';

const FETCH_EVALUATION_LIST_KEY = 'FETCH_EVALUATION_LIST_KEY';

export interface RAGEvalEvaluationAction {
  checkEvaluationStatus: (id: string) => Promise<void>;

  createNewEvaluation: (params: CreateNewEvalEvaluation) => Promise<void>;
  refreshEvaluationList: () => Promise<void>;

  removeEvaluation: (id: string) => Promise<void>;
  runEvaluation: (id: string) => Promise<void>;

  useFetchEvaluationList: (knowledgeBaseId: string) => SWRResponse<RAGEvalDataSetItem[]>;
}

export const createRagEvalEvaluationSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  RAGEvalEvaluationAction
> = (set, get) => ({
  checkEvaluationStatus: async (id) => {
    await ragEvalService.checkEvaluationStatus(id);
  },

  createNewEvaluation: async (params) => {
    await ragEvalService.createEvaluation(params);
    await get().refreshEvaluationList();
  },
  refreshEvaluationList: async () => {
    await mutate(FETCH_EVALUATION_LIST_KEY);
  },

  removeEvaluation: async (id) => {
    await ragEvalService.removeEvaluation(id);
    // await get().refreshEvaluationList();
  },

  runEvaluation: async (id) => {
    await ragEvalService.startEvaluationTask(id);
  },

  useFetchEvaluationList: (knowledgeBaseId) =>
    useClientDataSWR<RAGEvalDataSetItem[]>(
      [FETCH_EVALUATION_LIST_KEY, knowledgeBaseId],
      () => ragEvalService.getEvaluationList(knowledgeBaseId),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!get().initDatasetList)
            set({ initDatasetList: true }, false, 'useFetchDatasets/init');
        },
      },
    ),
});
