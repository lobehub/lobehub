import type { ChannelPublicMember } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { carouselMembers, carouselWindow } from './memberCarousel';

const member = (id: string, overrides: Partial<ChannelPublicMember> = {}): ChannelPublicMember => ({
  actorType: 'user',
  agentId: null,
  avatar: null,
  description: null,
  id,
  invitedBy: null,
  joinedAt: new Date('2026-11-01T00:00:00Z'),
  name: id,
  role: 'member',
  status: 'active',
  userAvatar: null,
  userId: id,
  userName: id,
  username: id,
  ...overrides,
});

describe('carouselMembers', () => {
  it('lists active people before Agents, each in join order', () => {
    const members = [
      member('agent-early', { actorType: 'agent', joinedAt: new Date('2026-10-01') }),
      member('late', { joinedAt: new Date('2026-11-03') }),
      member('left', { status: 'left' }),
      member('early', { joinedAt: new Date('2026-11-02') }),
    ];

    expect(carouselMembers(members).map((entry) => entry.id)).toEqual([
      'early',
      'late',
      'agent-early',
    ]);
  });
});

describe('carouselWindow', () => {
  const ids = (window: ReturnType<typeof carouselWindow>) => window.map((entry) => entry.member.id);

  it('keeps up to three members still, keyed by member', () => {
    const members = [member('a'), member('b'), member('c')];

    expect(carouselWindow(members, 5)).toEqual([
      { key: 'a', member: members[0] },
      { key: 'b', member: members[1] },
      { key: 'c', member: members[2] },
    ]);
  });

  it('moves a window of three on by one per step and wraps around', () => {
    const members = ['a', 'b', 'c', 'd'].map((id) => member(id));

    expect(ids(carouselWindow(members, 0))).toEqual(['a', 'b', 'c']);
    expect(ids(carouselWindow(members, 1))).toEqual(['b', 'c', 'd']);
    expect(ids(carouselWindow(members, 2))).toEqual(['c', 'd', 'a']);
  });

  it('keeps the two avatars that stay under their keys, and gives a returning member a new one', () => {
    const members = ['a', 'b', 'c', 'd'].map((id) => member(id));
    const before = carouselWindow(members, 0).map((entry) => entry.key);
    const after = carouselWindow(members, 1).map((entry) => entry.key);

    expect(after.slice(0, 2)).toEqual(before.slice(1));
    // `a` leaves at step 1 and comes back on the right at step 2, under a key it has not had.
    expect(carouselWindow(members, 2)[2]).toEqual({ key: 'step-4', member: members[0] });
    expect(before).not.toContain('step-4');
  });
});
