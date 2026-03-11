import  { type AgentEvalDataset } from '@lobechat/types';
import { produce } from 'immer';

type SetDatasetDetailAction = {
  id: string;
  type: 'setDatasetDetail';
  value: AgentEvalDataset;
};

type UpdateDatasetDetailAction = {
  id: string;
  type: 'updateDatasetDetail';
  value: Partial<AgentEvalDataset>;
};

type DeleteDatasetDetailAction = {
  id: string;
  type: 'deleteDatasetDetail';
};

export type DatasetDetailDispatch =
  | SetDatasetDetailAction
  | UpdateDatasetDetailAction
  | DeleteDatasetDetailAction;

export const datasetDetailReducer = (
  state: Record<string, AgentEvalDataset> = {},
  payload: DatasetDetailDispatch,
): Record<string, AgentEvalDataset> => {
  switch (payload.type) {
    case 'setDatasetDetail': {
      return produce(state, (draft) => {
        draft[payload.id] = payload.value;
      });
    }

    case 'updateDatasetDetail': {
      return produce(state, (draft) => {
        if (draft[payload.id]) {
          draft[payload.id] = { ...draft[payload.id], ...payload.value };
        }
      });
    }

    case 'deleteDatasetDetail': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default: {
      return state;
    }
  }
};
