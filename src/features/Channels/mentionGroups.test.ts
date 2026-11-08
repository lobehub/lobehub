import type { ChannelPublicMember } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  getMentionGroups,
  matchInviteAgents,
  MENTION_INVITE_LIMIT,
  mentionDescription,
} from './mentionGroups';

const member = (
  id: string,
  actorType: ChannelPublicMember['actorType'],
  name: string | null,
): ChannelPublicMember => ({
  actorType,
  agentId: actorType === 'agent' ? id : null,
  avatar: null,
  description: null,
  id,
  joinedAt: new Date(0),
  name,
  role: null,
  status: 'active',
  userAvatar: null,
  userId: actorType === 'user' ? id : null,
  userName: null,
  username: null,
});

const agent = member('agent', 'agent', 'Nasa');
const user = member('user', 'user', 'Arvin');
const otherUser = member('other-user', 'user', 'Lin');
const otherAgent = member('other-agent', 'agent', 'Code helper');

describe('Channel mention groups', () => {
  it('returns personal-space matches without actor section headings', () => {
    expect(getMentionGroups([agent, otherAgent], '', 'Former member', false)).toEqual([
      { actorType: undefined, members: [agent, otherAgent] },
    ]);
    expect(getMentionGroups([agent], 'zzzzzzz', 'Former member', false)).toEqual([]);
  });

  it('retains the Agent section in team spaces even without matching people', () => {
    expect(getMentionGroups([agent], '', 'Former member', true)).toEqual([
      { actorType: 'agent', members: [agent] },
    ]);
  });

  it('puts members before Agents and preserves the original order within each group', () => {
    expect(getMentionGroups([agent, user, otherAgent, otherUser], '', 'Former member')).toEqual([
      { actorType: 'user', members: [user, otherUser] },
      { actorType: 'agent', members: [agent, otherAgent] },
    ]);
  });

  it.each([user, agent])('omits empty sections when only $actorType matches', (match) => {
    expect(getMentionGroups([agent, user], match.name!, 'Former member')).toEqual([
      { actorType: match.actorType, members: [match] },
    ]);
  });

  it('keeps same-named members and Agents distinct while searching', () => {
    const sameNameUser = member('human-nasa', 'user', 'Nasa');
    expect(getMentionGroups([agent, sameNameUser], 'nasa', 'Former member')).toEqual([
      { actorType: 'user', members: [sameNameUser] },
      { actorType: 'agent', members: [agent] },
    ]);
  });

  it('keeps fuzzy search and ranks exact matches first within a group', () => {
    const extended = member('extended', 'agent', 'Nasa helper');
    expect(getMentionGroups([extended, agent], 'nasa', 'Former member')[0].members).toEqual([
      agent,
      extended,
    ]);
    expect(getMentionGroups([agent], 'nsa', 'Former member')[0].members).toEqual([agent]);
  });

  it('searches the displayed fallback names and Chinese names', () => {
    const unnamed = { ...member('unnamed', 'user', null), userName: '林同学' };
    expect(getMentionGroups([unnamed, agent], '林', 'Former member')[0].members).toEqual([unnamed]);
    const former = member('former', 'user', null);
    expect(getMentionGroups([former], 'Former', 'Former member')[0].members).toEqual([former]);
  });

  it('returns no sections for an empty list or no matches', () => {
    expect(getMentionGroups([], '', 'Former member')).toEqual([]);
    expect(getMentionGroups([user, agent], 'zzzzzzz', 'Former member')).toEqual([]);
  });
});

describe('Agents an @mention can invite', () => {
  const outside = [
    { id: 'agt_writer', name: 'Writer' },
    { id: 'agt_review', name: 'Code reviewer' },
    { id: 'agt_lead', name: 'Project writer' },
    { id: 'agt_joined', name: 'Writer two' },
  ];
  const match = (query: string, priorityIds: string[] = []) =>
    matchInviteAgents(outside, {
      exclude: ['agt_joined'],
      nameOf: (agent) => agent.name,
      priorityIds,
      query,
    }).map((agent) => agent.id);

  it('lists nobody until a name is typed', () => {
    expect(match('')).toEqual([]);
    expect(match('   ')).toEqual([]);
  });

  it('matches names case-insensitively and skips Agents already in the Channel', () => {
    expect(match('WRITER')).toEqual(['agt_writer', 'agt_lead']);
    expect(match('zzz')).toEqual([]);
  });

  it("puts the project's own Agents first", () => {
    expect(match('writer', ['agt_lead'])).toEqual(['agt_lead', 'agt_writer']);
  });

  it('caps the suggestions', () => {
    const many = Array.from({ length: MENTION_INVITE_LIMIT + 3 }, (_, index) => ({
      id: `agt_${index}`,
      name: `Helper ${index}`,
    }));
    expect(
      matchInviteAgents(many, {
        exclude: [],
        nameOf: (a) => a.name,
        priorityIds: [],
        query: 'helper',
      }),
    ).toHaveLength(MENTION_INVITE_LIMIT);
  });
});

describe('mention option description', () => {
  it('shows the Agent role before what it does', () => {
    expect(mentionDescription('设计助手', '界面设计', '审查界面稿')).toBe('界面设计 · 审查界面稿');
  });

  it('skips blank details and one that repeats the name', () => {
    expect(mentionDescription('数据分析师', null, '  ', '分析指标')).toBe('分析指标');
    expect(mentionDescription('Coder', 'Coder', 'Writes code')).toBe('Writes code');
  });

  it('gives a plain person no second line', () => {
    expect(mentionDescription('Alice', undefined, '')).toBeUndefined();
  });
});
