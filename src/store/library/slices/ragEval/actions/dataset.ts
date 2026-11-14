import { type CreateNewEvalDatasets } from '@lobechat/types';

import { mutate } from '@/libs/swr';
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

  constructor(_set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _set;
    void _api;
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
}

export type RAGEvalDatasetAction = Pick<RAGEvalDatasetActionImpl, keyof RAGEvalDatasetActionImpl>;
