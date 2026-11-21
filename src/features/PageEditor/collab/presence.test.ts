import { describe, expect, it } from 'vitest';

import {
  dropRecoloredCursors,
  getPresenceColor,
  PRESENCE_COLORS,
  type PresenceAwarenessData,
  resolvePresenceColor,
  samePresencePeers,
  toPresencePeers,
} from './presence';

const user = (
  clientId: number,
  name: string,
  awarenessData?: PresenceAwarenessData,
  color = '#000',
) => ({
  clientId,
  state: {
    anchorPos: null,
    awarenessData: awarenessData ?? {},
    color,
    focusPos: null,
    focusing: true,
    name,
  },
});

describe('getPresenceColor', () => {
  it('gives the same user the same palette color every time', () => {
    const color = getPresenceColor('user_lin');

    expect(PRESENCE_COLORS).toContain(color);
    expect(getPresenceColor('user_lin')).toBe(color);
  });

  it('spreads different users across the palette', () => {
    const colors = new Set(
      Array.from({ length: 40 }, (_, index) => getPresenceColor(`user_${index}`)),
    );

    expect(colors.size).toBeGreaterThan(PRESENCE_COLORS.length / 2);
  });
});

describe('toPresencePeers', () => {
  const self = { clientId: 1, userId: 'me' };

  it('leaves out this tab and the same user in other tabs', () => {
    const peers = toPresencePeers(
      [
        user(1, 'Me', { userId: 'me' }),
        user(2, 'Me', { userId: 'me' }),
        user(3, 'Lin Wei', { userId: 'lin' }),
      ],
      self,
    );

    expect(peers.map((peer) => peer.userId)).toEqual(['lin']);
  });

  it('shows a person once when they have several tabs, preferring an active one', () => {
    const peers = toPresencePeers(
      [user(4, 'Lin Wei', { away: true, userId: 'lin' }), user(5, 'Lin Wei', { userId: 'lin' })],
      self,
    );

    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ away: false, clientId: 5, userId: 'lin' });
  });

  it('puts away people after active ones', () => {
    const peers = toPresencePeers(
      [user(2, 'Jun Kim', { away: true, userId: 'jun' }), user(3, 'Lin Wei', { userId: 'lin' })],
      self,
    );

    expect(peers.map((peer) => peer.name)).toEqual(['Lin Wei', 'Jun Kim']);
  });

  it('colors each person with the color they broadcast and carries their avatar', () => {
    const [peer] = toPresencePeers(
      [user(3, 'Lin Wei', { avatar: 'https://a/lin.png', userId: 'lin' }, PRESENCE_COLORS[5])],
      self,
    );

    expect(peer).toMatchObject({ avatar: 'https://a/lin.png', color: PRESENCE_COLORS[5] });
  });

  it('falls back to the user id color when a client broadcasts none', () => {
    const [peer] = toPresencePeers([user(3, 'Lin Wei', { userId: 'lin' }, '')], self);

    expect(peer.color).toBe(getPresenceColor('lin'));
  });

  it('ignores cleared states and clients without a user id', () => {
    const peers = toPresencePeers(
      [
        { clientId: 2, state: null as never },
        user(3, 'Old client'),
        user(4, 'Lin Wei', { userId: 'lin' }),
      ],
      self,
    );

    expect(peers.map((peer) => peer.userId)).toEqual(['lin']);
  });
});

describe('resolvePresenceColor', () => {
  const preferred = getPresenceColor('me');
  const nextColor = (color: string, step = 1) =>
    PRESENCE_COLORS[(PRESENCE_COLORS.indexOf(color) + step) % PRESENCE_COLORS.length];
  const self = { clientId: 10, color: preferred, joinedAt: 100, userId: 'me' };

  it('keeps its color when nobody else on the page has it', () => {
    const color = resolvePresenceColor(
      [user(2, 'Lin Wei', { joinedAt: 50, userId: 'lin' }, nextColor(preferred))],
      self,
    );

    expect(color).toBe(preferred);
  });

  it('moves to the next free color when someone who joined earlier has it', () => {
    const color = resolvePresenceColor(
      [
        user(2, 'Lin Wei', { joinedAt: 50, userId: 'lin' }, preferred),
        user(3, 'Jun Kim', { joinedAt: 60, userId: 'jun' }, nextColor(preferred)),
      ],
      self,
    );

    expect(color).toBe(nextColor(preferred, 2));
  });

  it('keeps its color when someone who joined later has it', () => {
    const color = resolvePresenceColor(
      [user(2, 'Lin Wei', { joinedAt: 200, userId: 'lin' }, preferred)],
      self,
    );

    expect(color).toBe(preferred);
  });

  it('breaks a join-time tie by client id', () => {
    const peers = [user(2, 'Lin Wei', { joinedAt: 100, userId: 'lin' }, preferred)];

    expect(resolvePresenceColor(peers, self)).toBe(nextColor(preferred));
    expect(resolvePresenceColor(peers, { ...self, clientId: 1 })).toBe(preferred);
  });

  it('keeps a moved color after the earlier holder leaves', () => {
    const moved = nextColor(preferred);

    expect(resolvePresenceColor([], { ...self, color: moved })).toBe(moved);
  });

  it('returns to its preferred color when its moved color is taken by an earlier joiner', () => {
    const color = resolvePresenceColor(
      [user(2, 'Lin Wei', { joinedAt: 50, userId: 'lin' }, nextColor(preferred))],
      { ...self, color: nextColor(preferred) },
    );

    expect(color).toBe(preferred);
  });

  it('matches the color of its own earlier tab', () => {
    const color = resolvePresenceColor(
      [user(2, 'Me', { joinedAt: 50, userId: 'me' }, nextColor(preferred, 3))],
      self,
    );

    expect(color).toBe(nextColor(preferred, 3));
  });

  it('treats a client without a join time as having joined first', () => {
    const color = resolvePresenceColor([user(2, 'Old client', { userId: 'old' }, preferred)], self);

    expect(color).toBe(nextColor(preferred));
  });

  it('keeps its preferred color when every palette color is taken', () => {
    const color = resolvePresenceColor(
      PRESENCE_COLORS.map((paletteColor, index) =>
        user(index + 1, `Peer ${index}`, { joinedAt: 1, userId: `peer_${index}` }, paletteColor),
      ),
      self,
    );

    expect(color).toBe(preferred);
  });
});

describe('dropRecoloredCursors', () => {
  const cursorWithSelection = (color: string) => {
    const element = document.createElement('span');
    document.body.append(element);
    return { color, element, cursor: { color, selection: { selections: [element] } } };
  };

  it('removes a cursor drawn in a color its owner no longer broadcasts', () => {
    const stale = cursorWithSelection('#111');
    const cursors = new Map([[2, stale.cursor]]);

    dropRecoloredCursors(cursors, new Map([[2, { color: '#222' }]]));

    expect(cursors.has(2)).toBe(false);
    expect(stale.element.isConnected).toBe(false);
  });

  it('leaves cursors whose color still matches', () => {
    const current = cursorWithSelection('#111');
    const cursors = new Map([[2, current.cursor]]);

    dropRecoloredCursors(cursors, new Map([[2, { color: '#111' }]]));

    expect(cursors.get(2)).toBe(current.cursor);
    expect(current.element.isConnected).toBe(true);
  });
});

describe('samePresencePeers', () => {
  const peer = {
    away: false,
    clientId: 2,
    color: PRESENCE_COLORS[0],
    name: 'Lin Wei',
    userId: 'lin',
  };

  it('treats an identical list as unchanged', () => {
    expect(samePresencePeers([peer], [{ ...peer }])).toBe(true);
  });

  it('treats a color change as a change', () => {
    expect(samePresencePeers([peer], [{ ...peer, color: PRESENCE_COLORS[1] }])).toBe(false);
  });
});
