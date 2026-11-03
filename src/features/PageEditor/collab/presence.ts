import type { YjsAwarenessUser } from '@lobehub/editor';

// Violet stays out: it is the Page Agent's color in the presence stack.
export const PRESENCE_COLORS = [
  '#4f7cff',
  '#e8833a',
  '#2fa877',
  '#d9539b',
  '#1f9fb4',
  '#c99a1e',
  '#e5534b',
  '#a0704b',
];

export interface PresenceAwarenessData {
  avatar?: string;
  away?: boolean;
  userId?: string;
}

export interface PresencePeer {
  avatar?: string;
  away: boolean;
  clientId: number;
  color: string;
  name: string;
  userId: string;
}

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

export const getPresenceColor = (userId: string) =>
  PRESENCE_COLORS[hashString(userId) % PRESENCE_COLORS.length];

export const toPresencePeers = (
  users: YjsAwarenessUser[],
  self: { clientId: number; userId?: string },
): PresencePeer[] => {
  const byUser = new Map<string, PresencePeer>();

  for (const { clientId, state } of users) {
    if (!state || clientId === self.clientId) continue;
    const data = (state.awarenessData ?? {}) as PresenceAwarenessData;
    if (!data.userId || data.userId === self.userId) continue;

    const peer: PresencePeer = {
      avatar: data.avatar,
      away: !!data.away,
      clientId,
      color: getPresenceColor(data.userId),
      name: state.name,
      userId: data.userId,
    };
    const existing = byUser.get(data.userId);
    if (!existing || (existing.away && !peer.away)) byUser.set(data.userId, peer);
  }

  return [...byUser.values()].sort(
    (a, b) => Number(a.away) - Number(b.away) || a.clientId - b.clientId,
  );
};
