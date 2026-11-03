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
  joinedAt?: number;
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

export const samePresencePeers = (a: PresencePeer[], b: PresencePeer[]) =>
  a.length === b.length &&
  a.every(
    (peer, index) =>
      peer.clientId === b[index].clientId &&
      peer.away === b[index].away &&
      peer.color === b[index].color &&
      peer.name === b[index].name &&
      peer.avatar === b[index].avatar,
  );

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
      color: state.color || getPresenceColor(data.userId),
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

// Only an earlier joiner can push this client off a color, so colors never flip when
// someone joins later or leaves. Clients predating joinedAt count as earliest.
export const resolvePresenceColor = (
  users: YjsAwarenessUser[],
  self: { clientId: number; color: string; joinedAt: number; userId: string },
) => {
  const earlier = users.filter(({ clientId, state }) => {
    if (!state || clientId === self.clientId) return false;
    const joinedAt = (state.awarenessData as PresenceAwarenessData | undefined)?.joinedAt ?? 0;
    return joinedAt < self.joinedAt || (joinedAt === self.joinedAt && clientId < self.clientId);
  });

  const ownTab = earlier.find(
    ({ state }) =>
      (state.awarenessData as PresenceAwarenessData | undefined)?.userId === self.userId,
  );
  if (ownTab?.state.color) return ownTab.state.color;

  const taken = new Set(earlier.map(({ state }) => state.color));
  if (!taken.has(self.color)) return self.color;

  const preferred = getPresenceColor(self.userId);
  const start = PRESENCE_COLORS.indexOf(preferred);
  for (let step = 0; step < PRESENCE_COLORS.length; step++) {
    const candidate = PRESENCE_COLORS[(start + step) % PRESENCE_COLORS.length];
    if (!taken.has(candidate)) return candidate;
  }
  return preferred;
};

interface RemoteCursor {
  color: string;
  selection: { selections: HTMLElement[] } | null;
}

// Lexical paints a remote cursor once with the color it first saw and never repaints it;
// dropping the cursor makes the next sync redraw it in the owner's current color.
export const dropRecoloredCursors = (
  cursors: Map<number, RemoteCursor>,
  states: Map<number, { color?: unknown }>,
) => {
  for (const [clientId, cursor] of cursors) {
    const color = states.get(clientId)?.color;
    if (typeof color !== 'string' || !color || color === cursor.color) continue;
    cursor.selection?.selections.forEach((element) => element.remove());
    cursors.delete(clientId);
  }
};
