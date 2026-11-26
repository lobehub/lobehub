import type { ChannelPublicMember, ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { channelJoinEvents, channelTimeline } from './joinEvents';

const member = (id: string, joinedAt: number, patch: Partial<ChannelPublicMember> = {}) =>
  ({
    actorType: 'agent',
    id,
    invitedBy: null,
    joinedAt: new Date(joinedAt),
    role: null,
    ...patch,
  }) as ChannelPublicMember;
const owner = member('owner', 0, { actorType: 'user', role: 'owner' });
const message = (id: string, at: number) =>
  ({ createdAt: new Date(at), id }) as ChannelPublicMessage;

describe('channelJoinEvents', () => {
  it('groups members one person added together and names that person', () => {
    const events = channelJoinEvents([
      owner,
      member('a', 10, { invitedBy: 'owner' }),
      member('b', 20, { invitedBy: 'owner' }),
      member('c', 60_000, { invitedBy: 'owner' }),
    ]);
    expect(events.map((event) => event.members.map((entry) => entry.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(events.every((event) => event.inviter === owner)).toBe(true);
  });

  it('names the admin who added a member, not the owner', () => {
    const admin = member('admin', 0, { actorType: 'user', invitedBy: 'owner', role: 'admin' });
    const [, event] = channelJoinEvents([
      owner,
      admin,
      member('a', 60_000, { invitedBy: 'admin' }),
    ]);
    expect(event.inviter).toBe(admin);
  });

  it('names no inviter for someone who joined on their own', () => {
    const [event] = channelJoinEvents([owner, member('a', 60_000, { actorType: 'user' })]);
    expect(event.inviter).toBeUndefined();
  });

  it('splits members joining together when different people added them', () => {
    const events = channelJoinEvents([
      owner,
      member('a', 10, { invitedBy: 'owner' }),
      member('b', 20, { actorType: 'user' }),
    ]);
    expect(events.map((event) => event.members.map((entry) => entry.id))).toEqual([['a'], ['b']]);
  });
});

describe('channelTimeline', () => {
  const events = channelJoinEvents([owner, member('a', 10), member('b', 50_000)]);

  it('places join lines between messages by time', () => {
    const items = channelTimeline([message('m1', 20_000), message('m2', 60_000)], events, true);
    expect(items.map((item) => (item.kind === 'event' ? item.event.id : item.message.id))).toEqual([
      'join:a',
      'm1',
      'join:b',
      'm2',
    ]);
  });

  it('shows joins before the first loaded message only when the page starts the Channel', () => {
    const items = channelTimeline([message('m1', 20_000)], events, false);
    expect(items.map((item) => (item.kind === 'event' ? item.event.id : item.message.id))).toEqual([
      'm1',
      'join:b',
    ]);
    expect(channelTimeline([], events, true)).toHaveLength(2);
  });
});
