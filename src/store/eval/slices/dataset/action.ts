import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

import { type DatasetDetailDispatch, datasetDetailReducer } from './reducer';

const FETCH_DATASETS_KEY = 'FETCH_DATASETS';
const FETCH_DATASET_DETAIL_KEY = 'FETCH_DATASET_DETAIL';

type Setter = StoreSetter<EvalStore>;

export const createDatasetSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new DatasetActionImpl(set, get, _api);

export class DatasetActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshDatasetDetail = async (id: string): Promise<void> => {
    await mutate([FETCH_DATASET_DETAIL_KEY, id]);
  };

  refreshDatasets = async (benchmarkId: string): Promise<void> => {
    await mutate([FETCH_DATASETS_KEY, benchmarkId]);
  };

  useFetchDatasetDetail = (id?: string): SWRResponse =>
    useClientDataSWR(
      id ? [FETCH_DATASET_DETAIL_KEY, id] : null,
      () => agentEvalService.getDataset(id!),
      {
        onSuccess: (data: any) => {
          this.#get().internal_dispatchDatasetDetail({
            id: id!,
            type: 'setDatasetDetail',
            value: data,
          });
          this.#get().internal_updateDatasetDetailLoading(id!, false);
        },
      },
    );

  useFetchDatasets = (benchmarkId?: string): SWRResponse =>
    useClientDataSWR(
      benchmarkId ? [FETCH_DATASETS_KEY, benchmarkId] : null,
      () => agentEvalService.listDatasets(benchmarkId!),
      {
        onSuccess: (data: any) => {
          this.#set(
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

  internal_dispatchDatasetDetail = (payload: DatasetDetailDispatch): void => {
    const currentMap = this.#get().datasetDetailMap;
    const nextMap = datasetDetailReducer(currentMap, payload);

    if (isEqual(nextMap, currentMap)) return;

    this.#set({ datasetDetailMap: nextMap }, false, `dispatchDatasetDetail/${payload.type}`);
  };

  internal_updateDatasetDetailLoading = (id: string, loading: boolean): void => {
    this.#set(
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
  };
}

export type DatasetAction = Pick<DatasetActionImpl, keyof DatasetActionImpl>;
