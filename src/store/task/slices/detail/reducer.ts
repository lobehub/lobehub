import type { TaskDetailData } from '@lobechat/types';
import { produce } from 'immer';

export type TaskDetailDispatch =
  | { id: string; type: 'deleteTaskDetail' }
  | { id: string; type: 'setTaskDetail'; value: TaskDetailData }
  | { id: string; type: 'updateTaskDetail'; value: Partial<TaskDetailData> };

export const taskDetailReducer = (
  state: Record<string, TaskDetailData>,
  payload: TaskDetailDispatch,
): Record<string, TaskDetailData> => {
  switch (payload.type) {
    case 'setTaskDetail': {
      return produce(state, (draft) => {
        draft[payload.id] = payload.value;
      });
    }

    case 'updateTaskDetail': {
      return produce(state, (draft) => {
        if (draft[payload.id]) {
          Object.assign(draft[payload.id], payload.value);
        }
      });
    }

    case 'deleteTaskDetail': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default: {
      return state;
    }
  }
};
