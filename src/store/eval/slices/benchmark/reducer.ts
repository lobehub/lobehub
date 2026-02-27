import  { type AgentEvalBenchmark } from '@lobechat/types';
import { produce } from 'immer';

type SetBenchmarkDetailAction = {
  id: string;
  type: 'setBenchmarkDetail';
  value: AgentEvalBenchmark;
};

type UpdateBenchmarkDetailAction = {
  id: string;
  type: 'updateBenchmarkDetail';
  value: Partial<AgentEvalBenchmark>;
};

type DeleteBenchmarkDetailAction = {
  id: string;
  type: 'deleteBenchmarkDetail';
};

export type BenchmarkDetailDispatch =
  | SetBenchmarkDetailAction
  | UpdateBenchmarkDetailAction
  | DeleteBenchmarkDetailAction;

export const benchmarkDetailReducer = (
  state: Record<string, AgentEvalBenchmark> = {},
  payload: BenchmarkDetailDispatch,
): Record<string, AgentEvalBenchmark> => {
  switch (payload.type) {
    case 'setBenchmarkDetail': {
      return produce(state, (draft) => {
        draft[payload.id] = payload.value;
      });
    }

    case 'updateBenchmarkDetail': {
      return produce(state, (draft) => {
        if (draft[payload.id]) {
          draft[payload.id] = { ...draft[payload.id], ...payload.value };
        }
      });
    }

    case 'deleteBenchmarkDetail': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default: {
      return state;
    }
  }
};
