import type { ChannelPublicMember, ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { channelJoinEvents, channelTimeline, isSelfJoinable } from './joinEvents';

const member = (id: string, joinedAt: number, patch: Partial<ChannelPublicMember> = {}) =>
  ({
    actorType: 'agent',
    id,
    joinedAt: new Date(joinedAt),
    role: null,
    ...patch,
  }) as ChannelPublicMember;
const owner = member('owner', 0, { actorType: 'user', role: 'owner' });
const message = (id: string, at: number) =>
  ({ createdAt: new Date(at), id }) as ChannelPublicMessage;

describe('channelJoinEvents', () => {
  it('groups members added together and credits the owner', () => {
    const events = channelJoinEvents([
      owner,
      member('a', 10),
      member('b', 20),
      member('c', 60_000),
    ]);
    expect(events.map((event) => event.members.map((entry) => entry.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(events.every((event) => event.inviter === owner)).toBe(true);
  });

  it('names no inviter where people join by themselves', () => {
    const [event] = channelJoinEvents([owner, member('a', 60_000, { actorType: 'user' })], {
      selfJoinable: true,
    });
    expect(event.inviter).toBeUndefined();
  });

  it.each([
    [{ projectId: 'prj_1', visibility: 'private', workspaceId: 'ws' }, true],
    [{ projectId: null, visibility: 'public', workspaceId: 'ws' }, true],
    [{ projectId: null, visibility: 'private', workspaceId: 'ws' }, false],
    [{ projectId: 'prj_1', visibility: 'private', workspaceId: null }, false],
  ] as const)('tells which Channels take self-joins: %o → %s', (channel, expected) => {
    expect(isSelfJoinable(channel)).toBe(expected);
  });

  it('does not guess the inviter when an admin could have added members', () => {
    const [event] = channelJoinEvents([
      owner,
      member('admin', 0, { actorType: 'user', role: 'admin' }),
      member('a', 60_000),
    ]);
    expect(event.inviter).toBeUndefined();
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
