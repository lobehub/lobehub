import { type CreateNewEvalEvaluation, type RAGEvalDataSetItem } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { ragEvalKeys } from '@/libs/swr/keys';
import { ragEvalService } from '@/services/ragEval';
import { type KnowledgeBaseStore } from '@/store/library/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createRagEvalEvaluationSlice = (
  set: Setter,
  get: () => KnowledgeBaseStore,
  _api?: unknown,
) => new RAGEvalEvaluationActionImpl(set, get, _api);

export class RAGEvalEvaluationActionImpl {
  readonly #get: () => KnowledgeBaseStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  checkEvaluationStatus = async (id: string): Promise<void> => {
    await ragEvalService.checkEvaluationStatus(id);
  };

  createNewEvaluation = async (params: CreateNewEvalEvaluation): Promise<void> => {
    await ragEvalService.createEvaluation(params);
    await this.#get().refreshEvaluationList();
  };

  refreshEvaluationList = async (): Promise<void> => {
    await mutate(ragEvalKeys.evaluationList());
  };

  removeEvaluation = async (id: string): Promise<void> => {
    await ragEvalService.removeEvaluation(id);
    // await this.#get().refreshEvaluationList();
  };

  runEvaluation = async (id: string): Promise<void> => {
    await ragEvalService.startEvaluationTask(id);
  };

  useFetchEvaluationList = (knowledgeBaseId: string): SWRResponse<RAGEvalDataSetItem[]> => {
    return useClientDataSWR<RAGEvalDataSetItem[]>(
      ragEvalKeys.evaluationList(knowledgeBaseId),
      () => ragEvalService.getEvaluationList(knowledgeBaseId),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!this.#get().initDatasetList)
            this.#set({ initDatasetList: true }, false, 'useFetchDatasets/init');
        },
      },
    );
  };
}

export type RAGEvalEvaluationAction = Pick<
  RAGEvalEvaluationActionImpl,
  keyof RAGEvalEvaluationActionImpl
>;
