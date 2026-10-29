import type { ChannelPublicMember } from '@lobechat/types';
import Fuse from 'fuse.js';

import { memberName } from './memberName';

/** Keep mention search results grouped, preserving relevance within each actor type. */
export function getMentionGroups(
  members: ChannelPublicMember[],
  query: string,
  fallbackName: string,
) {
  const matches = query
    ? new Fuse(
        members.map((member) => ({ label: memberName(member, fallbackName), member })),
        { keys: ['label'] },
      )
        .search(query)
        .map(({ item }) => item.member)
    : members;

  return (['user', 'agent'] as const)
    .map((actorType) => ({
      actorType,
      members: matches.filter((member) => member.actorType === actorType),
    }))
    .filter((group) => group.members.length > 0);
}
