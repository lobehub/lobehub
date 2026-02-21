import {
  type CreateNewEvalDatasets,
  type EvalDatasetRecord,
  type RAGEvalDataSetItem,
} from '@lobechat/types';
import { insertEvalDatasetRecordSchema } from '@lobechat/types';
import i18n from 'i18next';
import { type SWRResponse } from 'swr';

import { notification } from '@/components/AntdStaticMethods';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { ragEvalService } from '@/services/ragEval';
import { type KnowledgeBaseStore } from '@/store/library/store';
import { type StoreSetter } from '@/store/types';

const FETCH_DATASET_LIST_KEY = 'FETCH_DATASET_LIST';
const FETCH_DATASET_RECORD_KEY = 'FETCH_DATASET_RECORD_KEY';

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

  importDataset = async (file: File, datasetId: string): Promise<void> => {
    if (!datasetId) return;
    const fileType = file.name.split('.').pop();

    if (fileType === 'jsonl') {
      // jsonl file needs to be split into individual entries, then validated one by one
      const jsonl = await file.text();
      const { default: JSONL } = await import('jsonl-parse-stringify');

      try {
        const items = JSONL.parse(jsonl);

        // check if the items are valid
        insertEvalDatasetRecordSchema.array().parse(items);

        // if valid, send to backend
        await ragEvalService.importDatasetRecords(datasetId, file);
      } catch (e) {
        notification.error({
          description: (e as Error).message,
          message: i18n.t('errors.invalidFileFormat', { ns: 'common' }),
        });
      }
    }

    await this.#get().refreshDatasetList();
  };

  refreshDatasetList = async (): Promise<void> => {
    await mutate(FETCH_DATASET_LIST_KEY);
  };

  removeDataset = async (id: string): Promise<void> => {
    await ragEvalService.removeDataset(id);
    await this.#get().refreshDatasetList();
  };

  useFetchDatasetRecords = (datasetId: string | null): SWRResponse<EvalDatasetRecord[]> => {
    return useClientDataSWR<EvalDatasetRecord[]>(
      !!datasetId ? [FETCH_DATASET_RECORD_KEY, datasetId] : null,
      () => ragEvalService.getDatasetRecords(datasetId!),
    );
  };

  useFetchDatasets = (knowledgeBaseId: string): SWRResponse<RAGEvalDataSetItem[]> => {
    return useClientDataSWR<RAGEvalDataSetItem[]>(
      [FETCH_DATASET_LIST_KEY, knowledgeBaseId],
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
