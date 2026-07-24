import { type AgentEvalExperimentDetail } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';
import { type EvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<EvalStore>;

export const createExperimentSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new ExperimentActionImpl(set, get, _api);

export class ExperimentActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createExperiment = async (params: {
    benchmarkIds: string[];
    description?: string;
    metadata?: Record<string, unknown>;
    name: string;
  }): Promise<any> => {
    const result = await agentEvalService.createExperiment(params);
    await this.#get().refreshExperiments();
    return result.data;
  };

  deleteExperiment = async (id: string): Promise<void> => {
    // Optimistic: drop from the list immediately, then revalidate.
    this.#set(
      (state) => ({ experimentList: state.experimentList.filter((e) => e.id !== id) }),
      false,
      'deleteExperiment/optimistic',
    );
    try {
      await agentEvalService.deleteExperiment(id);
    } finally {
      await this.#get().refreshExperiments();
    }
  };

  updateExperiment = async (params: {
    benchmarkIds?: string[];
    description?: string;
    id: string;
    metadata?: Record<string, unknown>;
    name?: string;
  }): Promise<void> => {
    await agentEvalService.updateExperiment(params);
    await Promise.all([
      this.#get().refreshExperiments(),
      this.#get().refreshExperimentDetail(params.id),
    ]);
  };

  refreshExperimentDetail = async (id: string): Promise<void> => {
    await mutate(evalKeys.experimentDetail(id));
  };

  refreshExperiments = async (): Promise<void> => {
    await mutate(evalKeys.experiments());
  };

  useFetchExperimentDetail = (id?: string): SWRResponse =>
    useClientDataSWR(
      id ? evalKeys.experimentDetail(id) : null,
      () => agentEvalService.getExperiment(id!),
      {
        onSuccess: (data: any) => {
          this.#get().internal_setExperimentDetail(id!, data.data);
          this.#get().internal_updateExperimentDetailLoading(id!, false);
        },
      },
    );

  useFetchExperiments = (): SWRResponse =>
    useClientDataSWR(evalKeys.experiments(), () => agentEvalService.listExperiments(), {
      onSuccess: (data: any) => {
        this.#set(
          {
            experimentList: data.data,
            experimentListInit: true,
          },
          false,
          'useFetchExperiments/success',
        );
      },
    });

  internal_setExperimentDetail = (id: string, value: AgentEvalExperimentDetail): void => {
    const currentMap = this.#get().experimentDetailMap;
    if (isEqual(currentMap[id], value)) return;

    this.#set(
      { experimentDetailMap: { ...currentMap, [id]: value } },
      false,
      'setExperimentDetail',
    );
  };

  internal_updateExperimentDetailLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) {
          return { loadingExperimentDetailIds: [...state.loadingExperimentDetailIds, id] };
        }
        return {
          loadingExperimentDetailIds: state.loadingExperimentDetailIds.filter((i) => i !== id),
        };
      },
      false,
      'updateExperimentDetailLoading',
    );
  };
}

export type ExperimentAction = Pick<ExperimentActionImpl, keyof ExperimentActionImpl>;
