import isEqual from 'fast-deep-equal';
import  { type SWRResponse } from 'swr';
import  { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import  { type EvalStore } from '@/store/eval/store';

import { type DatasetDetailDispatch,datasetDetailReducer } from './reducer';

const FETCH_DATASETS_KEY = 'FETCH_DATASETS';
const FETCH_DATASET_DETAIL_KEY = 'FETCH_DATASET_DETAIL';

export interface DatasetAction {
  // Internal methods
  internal_dispatchDatasetDetail: (payload: DatasetDetailDispatch) => void;
  internal_updateDatasetDetailLoading: (id: string, loading: boolean) => void;
  refreshDatasetDetail: (id: string) => Promise<void>;
  refreshDatasets: (benchmarkId: string) => Promise<void>;

  useFetchDatasetDetail: (id?: string) => SWRResponse;
  useFetchDatasets: (benchmarkId?: string) => SWRResponse;
}

export const createDatasetSlice: StateCreator<
  EvalStore,
  [['zustand/devtools', never]],
  [],
  DatasetAction
> = (set, get) => ({
  refreshDatasetDetail: async (id) => {
    await mutate([FETCH_DATASET_DETAIL_KEY, id]);
  },

  refreshDatasets: async (benchmarkId) => {
    await mutate([FETCH_DATASETS_KEY, benchmarkId]);
  },

  useFetchDatasetDetail: (id) => {
    return useClientDataSWR(
      id ? [FETCH_DATASET_DETAIL_KEY, id] : null,
      () => agentEvalService.getDataset(id!),
      {
        onSuccess: (data: any) => {
          get().internal_dispatchDatasetDetail({
            type: 'setDatasetDetail',
            id: id!,
            value: data,
          });
          get().internal_updateDatasetDetailLoading(id!, false);
        },
      },
    );
  },

  useFetchDatasets: (benchmarkId) => {
    return useClientDataSWR(
      benchmarkId ? [FETCH_DATASETS_KEY, benchmarkId] : null,
      () => agentEvalService.listDatasets(benchmarkId!),
      {
        onSuccess: (data: any) => {
          set(
            {
              datasetList: data,
              isLoadingDatasets: false,
            },
            false,
            'useFetchDatasets/success',
          );
        },
      },
    );
  },

  // Internal - Dispatch to reducer
  internal_dispatchDatasetDetail: (payload) => {
    const currentMap = get().datasetDetailMap;
    const nextMap = datasetDetailReducer(currentMap, payload);

    // No need to update if map is the same
    if (isEqual(nextMap, currentMap)) return;

    set({ datasetDetailMap: nextMap }, false, `dispatchDatasetDetail/${payload.type}`);
  },

  // Internal - Update loading state for specific detail
  internal_updateDatasetDetailLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          return { loadingDatasetDetailIds: [...state.loadingDatasetDetailIds, id] };
        }
        return {
          loadingDatasetDetailIds: state.loadingDatasetDetailIds.filter((i) => i !== id),
        };
      },
      false,
      'updateDatasetDetailLoading',
    );
  },
});
