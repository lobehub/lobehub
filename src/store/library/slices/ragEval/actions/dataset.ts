import {
  type CreateNewEvalDatasets,
  type EvalDatasetRecord,
  type RAGEvalDataSetItem,
  insertEvalDatasetRecordSchema,
} from '@lobechat/types';
import i18n from 'i18next';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { ragEvalService } from '@/services/ragEval';
import { type KnowledgeBaseStore } from '@/store/library/store';

const FETCH_DATASET_LIST_KEY = 'FETCH_DATASET_LIST';
const FETCH_DATASET_RECORD_KEY = 'FETCH_DATASET_RECORD_KEY';

export interface RAGEvalDatasetAction {
  createNewDataset: (params: CreateNewEvalDatasets) => Promise<void>;

  importDataset: (file: File, datasetId: string) => Promise<void>;
  refreshDatasetList: () => Promise<void>;
  removeDataset: (id: string) => Promise<void>;
  useFetchDatasetRecords: (datasetId: string | null) => SWRResponse<EvalDatasetRecord[]>;
  useFetchDatasets: (knowledgeBaseId: string) => SWRResponse<RAGEvalDataSetItem[]>;
}

export const createRagEvalDatasetSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  RAGEvalDatasetAction
> = (set, get) => ({
  createNewDataset: async (params) => {
    await ragEvalService.createDataset(params);
    await get().refreshDatasetList();
  },

  importDataset: async (file, datasetId) => {
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

    await get().refreshDatasetList();
  },
  refreshDatasetList: async () => {
    await mutate(FETCH_DATASET_LIST_KEY);
  },

  removeDataset: async (id) => {
    await ragEvalService.removeDataset(id);
    await get().refreshDatasetList();
  },
  useFetchDatasetRecords: (datasetId) =>
    useClientDataSWR<EvalDatasetRecord[]>(
      !!datasetId ? [FETCH_DATASET_RECORD_KEY, datasetId] : null,
      () => ragEvalService.getDatasetRecords(datasetId!),
    ),
  useFetchDatasets: (knowledgeBaseId) =>
    useClientDataSWR<RAGEvalDataSetItem[]>(
      [FETCH_DATASET_LIST_KEY, knowledgeBaseId],
      () => ragEvalService.getDatasets(knowledgeBaseId),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!get().initDatasetList)
            set({ initDatasetList: true }, false, 'useFetchDatasets/init');
        },
      },
    ),
});
