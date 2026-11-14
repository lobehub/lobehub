import type { YjsAwarenessUser } from '@lobehub/editor';
import { useEffect } from 'react';

import { dropRecoloredCursors, resolvePresenceColor } from './presence';

type AwarenessState = Record<string, unknown>;

interface PresenceAwareness {
  getLocalState: () => AwarenessState | null;
  getStates: () => Map<number, AwarenessState>;
  off: (type: 'update', listener: () => void) => void;
  on: (type: 'update', listener: () => void) => void;
  setLocalState: (state: AwarenessState) => void;
}

interface UsePresenceColorParams {
  awareness: PresenceAwareness | undefined;
  clientId: number | undefined;
  getCursors: () => Parameters<typeof dropRecoloredCursors>[0] | undefined;
  joinedAt: number | undefined;
  userId: string | undefined;
}

export const usePresenceColor = ({
  awareness,
  clientId,
  getCursors,
  joinedAt,
  userId,
}: UsePresenceColorParams) => {
  useEffect(() => {
    if (!awareness || clientId === undefined || joinedAt === undefined || !userId) return;

    const sync = () => {
      const states = awareness.getStates();
      const local = awareness.getLocalState();
      if (local) {
        const users = Array.from(states, ([id, state]) => ({
          clientId: id,
          state: state as YjsAwarenessUser['state'],
        }));
        const current = typeof local.color === 'string' ? local.color : '';
        const color = resolvePresenceColor(users, { clientId, color: current, joinedAt, userId });
        if (color !== current) {
          awareness.setLocalState({ ...local, color });
          return;
        }
      }
      const cursors = getCursors();
      if (cursors) dropRecoloredCursors(cursors, states);
    };

    awareness.on('update', sync);
    sync();
    return () => awareness.off('update', sync);
  }, [awareness, clientId, getCursors, joinedAt, userId]);
};
