import { produce } from 'immer';

import { type LobeSession, type LobeSessions } from '@/types/session';

interface AddSession {
  session: LobeSession;
  type: 'addSession';
}

interface RemoveSession {
  id: string;
  type: 'removeSession';
}

interface UpdateSession {
  id: string;
  type: 'updateSession';
  value: Partial<LobeSession>;
}

export type SessionDispatch = AddSession | RemoveSession | UpdateSession;

export const sessionsReducer = (state: LobeSessions, payload: SessionDispatch): LobeSessions => {
  switch (payload.type) {
    case 'addSession': {
      return produce(state, (draft) => {
        const { session } = payload;
        if (!session) return;

        // TODO: Migrate Date type in the future to remove this ignore
        // @ts-ignore
        draft.unshift({ ...session, createdAt: new Date(), updatedAt: new Date() });
      });
    }

    case 'removeSession': {
      return produce(state, (draftState) => {
        const index = draftState.findIndex((item) => item.id === payload.id);
        if (index !== -1) {
          draftState.splice(index, 1);
        }
      });
    }

    case 'updateSession': {
      return produce(state, (draftState) => {
        const { value, id } = payload;
        const index = draftState.findIndex((item) => item.id === id);

        if (index !== -1) {
          // @ts-ignore
          draftState[index] = { ...draftState[index], ...value, updatedAt: new Date() };
        }
      });
    }

    default: {
      return produce(state, () => {});
    }
  }
};
