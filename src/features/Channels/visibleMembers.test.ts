import type { ChannelPublicMember } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getVisibleStatusMembers } from './visibleMembers';

const member = (
  id: string,
  actorType: ChannelPublicMember['actorType'],
  status: ChannelPublicMember['status'] = 'active',
): ChannelPublicMember => ({
  actorType,
  agentId: actorType === 'agent' ? id : null,
  avatar: null,
  description: null,
  id,
  joinedAt: new Date(),
  name: id,
  role: null,
  status,
  userAvatar: null,
  userId: actorType === 'user' ? id : null,
  userName: null,
  username: null,
});

describe('Channel header member visibility', () => {
  const owner = member('owner', 'user');
  const agent = member('pi', 'agent');
  const inactiveAgent = member('removed-agent', 'agent', 'removed');
  const inactivePerson = member('removed-person', 'user', 'left');
  const members = [owner, agent, inactiveAgent, inactivePerson];

  it('shows only active Agents in personal channels without changing membership', () => {
    expect(getVisibleStatusMembers(members, null)).toEqual([agent]);
    expect(members).toEqual([owner, agent, inactiveAgent, inactivePerson]);
    expect(owner.status).toBe('active');
  });

  it('keeps the person in workspace channels even when there is only one person', () => {
    expect(getVisibleStatusMembers(members, 'workspace-1')).toEqual([owner, agent]);
  });

  it('hides the sole owner of a personal channel with no Agents', () => {
    expect(getVisibleStatusMembers([owner], null)).toEqual([]);
  });

  it('handles an empty member list in either scope', () => {
    expect(getVisibleStatusMembers([], null)).toEqual([]);
    expect(getVisibleStatusMembers([], 'workspace-1')).toEqual([]);
  });
});
