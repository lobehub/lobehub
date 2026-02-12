import { produce } from 'immer';

import { type ThreadItem } from '@/types/topic';

type UpdateThreadAction = {
  id: string;
  type: 'updateThread';
  value: Partial<ThreadItem>;
};

type DeleteThreadAction = {
  id: string;
  type: 'deleteThread';
};

export type ThreadDispatch = UpdateThreadAction | DeleteThreadAction;

export const threadReducer = (state: ThreadItem[] = [], payload: ThreadDispatch): ThreadItem[] => {
  switch (payload.type) {
    case 'updateThread': {
      return produce(state, (draftState) => {
        const { value, id } = payload;
        const threadIndex = draftState.findIndex((thread) => thread.id === id);

        if (threadIndex !== -1) {
          draftState[threadIndex] = {
            ...draftState[threadIndex],
            ...value,
            updatedAt: new Date(),
          };
        }
      });
    }

    case 'deleteThread': {
      return produce(state, (draftState) => {
        const threadIndex = draftState.findIndex((thread) => thread.id === payload.id);
        if (threadIndex !== -1) {
          draftState.splice(threadIndex, 1);
        }
      });
    }

    default: {
      return state;
    }
  }
};
