import type { ChannelPublicMember } from '@lobechat/types';
import Fuse from 'fuse.js';

import { splitByPriority } from './CreateChannel/projectAgentOrder';
import { memberName } from './memberName';

/** Keep mention search results grouped, preserving relevance within each actor type. */
export function getMentionGroups(
  members: ChannelPublicMember[],
  query: string,
  fallbackName: string,
  grouped = true,
) {
  const matches = query
    ? new Fuse(
        members.map((member) => ({ label: memberName(member, fallbackName), member })),
        { keys: ['label'] },
      )
        .search(query)
        .map(({ item }) => item.member)
    : members;

  if (!grouped) return matches.length ? [{ actorType: undefined, members: matches }] : [];

  return (['user', 'agent'] as const)
    .map((actorType) => ({
      actorType,
      members: matches.filter((member) => member.actorType === actorType),
    }))
    .filter((group) => group.members.length > 0);
}

/** At most this many outsiders of each kind follow the Channel's own members. */
export const MENTION_INVITE_LIMIT = 5;

/**
 * Agents outside the Channel whose name contains the query, the project's own first. An empty
 * query lists none: only a typed name reaches past the Channel's members.
 */
export function matchInviteAgents<T extends { id: string }>(
  agents: T[],
  {
    exclude,
    nameOf,
    priorityIds,
    query,
  }: { exclude: string[]; nameOf: (agent: T) => string; priorityIds: string[]; query: string },
) {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return [];
  const excluded = new Set(exclude);
  const matches = agents.filter(
    (agent) => !excluded.has(agent.id) && nameOf(agent).toLocaleLowerCase().includes(search),
  );
  const { others, priority } = splitByPriority(matches, priorityIds);
  return [...priority, ...others].slice(0, MENTION_INVITE_LIMIT);
}
