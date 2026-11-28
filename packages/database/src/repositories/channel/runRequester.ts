import { and, asc, eq, inArray } from 'drizzle-orm';

import { channelMembers, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { channelUserNameSql } from './nickname';

export interface ChannelRunRequester {
  /** As the run's Channel shows them: workspace nickname, else full name, else username. */
  name: string;
  userId: string;
}

/**
 * The person whose request a Channel run answers (`manifest.requesterMemberId`). For another
 * person's shared Agent the run executes as the Agent's owner, so this is how a service tells the
 * visitor apart from the execution identity. Undefined when the member is gone or not a person.
 */
export const findChannelRunRequester = async (
  db: LobeChatDatabase,
  channelId: string,
  memberId: string,
): Promise<ChannelRunRequester | undefined> => {
  const [row] = await db
    .select({
      name: channelUserNameSql(channelMembers.channelId, channelMembers.userId),
      userId: channelMembers.userId,
      username: users.username,
    })
    .from(channelMembers)
    .leftJoin(users, eq(users.id, channelMembers.userId))
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.id, memberId),
        eq(channelMembers.actorType, 'user'),
      ),
    )
    .limit(1);
  if (!row?.userId) return undefined;
  return { name: row.name || row.username || '', userId: row.userId };
};

/**
 * The names of each Channel's active people, oldest member first, so an Agent can find where it
 * reaches someone by name.
 */
export const channelPeopleNames = async (
  db: LobeChatDatabase,
  channelIds: string[],
): Promise<Map<string, string[]>> => {
  const people = new Map<string, string[]>();
  if (!channelIds.length) return people;
  const rows = await db
    .select({
      channelId: channelMembers.channelId,
      name: channelUserNameSql(channelMembers.channelId, channelMembers.userId),
      username: users.username,
    })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .where(
      and(
        inArray(channelMembers.channelId, channelIds),
        eq(channelMembers.actorType, 'user'),
        eq(channelMembers.status, 'active'),
      ),
    )
    .orderBy(asc(channelMembers.createdAt));
  for (const { channelId, name, username } of rows) {
    const label = name || username;
    if (!label) continue;
    people.set(channelId, [...(people.get(channelId) ?? []), label]);
  }
  return people;
};
