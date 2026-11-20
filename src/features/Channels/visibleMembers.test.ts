import type { ChannelPublicMember } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getVisibleStatusMembers, groupMembersByActor } from './visibleMembers';

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

  it('lists active people and Agents without changing membership', () => {
    expect(getVisibleStatusMembers(members)).toEqual([owner, agent]);
    expect(members).toEqual([owner, agent, inactiveAgent, inactivePerson]);
  });

  it('keeps the sole owner of a Channel with no Agents', () => {
    expect(getVisibleStatusMembers([owner])).toEqual([owner]);
  });

  it('handles an empty member list', () => {
    expect(getVisibleStatusMembers([])).toEqual([]);
  });
});

describe('Member list grouping', () => {
  it('puts people before Agents and keeps join order inside each group', () => {
    const entries = [
      member('agent-a', 'agent'),
      member('alice', 'user'),
      member('agent-b', 'agent'),
      member('bob', 'user'),
    ].map((m) => ({ member: m }));

    const { agents, people } = groupMembersByActor(entries);

    expect(people.map((entry) => entry.member.id)).toEqual(['alice', 'bob']);
    expect(agents.map((entry) => entry.member.id)).toEqual(['agent-a', 'agent-b']);
  });
});
