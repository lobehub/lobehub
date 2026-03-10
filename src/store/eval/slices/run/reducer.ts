import type { AgentEvalRunDetail } from '@lobechat/types';
import { produce } from 'immer';

type SetRunDetailAction = {
  id: string;
  type: 'setRunDetail';
  value: AgentEvalRunDetail;
};

type UpdateRunDetailAction = {
  id: string;
  type: 'updateRunDetail';
  value: Partial<AgentEvalRunDetail>;
};

type DeleteRunDetailAction = {
  id: string;
  type: 'deleteRunDetail';
};

export type RunDetailDispatch = SetRunDetailAction | UpdateRunDetailAction | DeleteRunDetailAction;

export const runDetailReducer = (
  state: Record<string, AgentEvalRunDetail> = {},
  payload: RunDetailDispatch,
): Record<string, AgentEvalRunDetail> => {
  switch (payload.type) {
    case 'setRunDetail': {
      return produce(state, (draft) => {
        draft[payload.id] = payload.value;
      });
    }

    case 'updateRunDetail': {
      return produce(state, (draft) => {
        if (draft[payload.id]) {
          draft[payload.id] = { ...draft[payload.id], ...payload.value };
        }
      });
    }

    case 'deleteRunDetail': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default: {
      return state;
    }
  }
};
