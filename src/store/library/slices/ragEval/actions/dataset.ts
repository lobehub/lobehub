import {
  type CreateNewEvalDatasets,
  type EvalDatasetRecord,
  type RAGEvalDataSetItem,
} from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { ragEvalKeys } from '@/libs/swr/keys';
import { ragEvalService } from '@/services/ragEval';
import { type KnowledgeBaseStore } from '@/store/library/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createRagEvalDatasetSlice = (
  set: Setter,
  get: () => KnowledgeBaseStore,
  _api?: unknown,
) => new RAGEvalDatasetActionImpl(set, get, _api);

export class RAGEvalDatasetActionImpl {
  readonly #get: () => KnowledgeBaseStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createNewDataset = async (params: CreateNewEvalDatasets): Promise<void> => {
    await ragEvalService.createDataset(params);
    await this.#get().refreshDatasetList();
  };

  refreshDatasetList = async (): Promise<void> => {
    await mutate(ragEvalKeys.datasetList());
  };

  removeDataset = async (id: string): Promise<void> => {
    await ragEvalService.removeDataset(id);
    await this.#get().refreshDatasetList();
  };

  useFetchDatasetRecords = (datasetId: string | null): SWRResponse<EvalDatasetRecord[]> => {
    return useClientDataSWR<EvalDatasetRecord[]>(
      !!datasetId ? ragEvalKeys.datasetRecords(datasetId) : null,
      () => ragEvalService.getDatasetRecords(datasetId!),
    );
  };

  useFetchDatasets = (knowledgeBaseId: string): SWRResponse<RAGEvalDataSetItem[]> => {
    return useClientDataSWR<RAGEvalDataSetItem[]>(
      ragEvalKeys.datasetList(knowledgeBaseId),
      () => ragEvalService.getDatasets(knowledgeBaseId),
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

export type RAGEvalDatasetAction = Pick<RAGEvalDatasetActionImpl, keyof RAGEvalDatasetActionImpl>;
