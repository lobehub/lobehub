import { describe, expect, it } from 'vitest';

import { getPresenceColor, PRESENCE_COLORS, toPresencePeers } from './presence';

const user = (
  clientId: number,
  name: string,
  awarenessData?: { avatar?: string; away?: boolean; userId?: string },
) => ({
  clientId,
  state: {
    anchorPos: null,
    awarenessData: awarenessData ?? {},
    color: '#000',
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

  it('colors each person by their user id and carries their avatar', () => {
    const [peer] = toPresencePeers(
      [user(3, 'Lin Wei', { avatar: 'https://a/lin.png', userId: 'lin' })],
      self,
    );

    expect(peer).toMatchObject({ avatar: 'https://a/lin.png', color: getPresenceColor('lin') });
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
