import { type SQL, sql, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { channels } from '../../schemas/channel';
import { users } from '../../schemas/user';
import { workspaceMembers } from '../../schemas/workspace';
import { memberNicknameSql } from '../../utils/workspaceMemberNickname';

// Aliased so the subquery never captures an outer `channels` / `workspace_members`
// reference passed in as `channelId` or `userId`. Inside raw `sql` an alias renders as its
// name only, so the `from` clauses spell out `<table> <alias>` themselves.
const CHANNEL_ALIAS = 'nickname_channel';
const MEMBER_ALIAS = 'nickname_member';
const nicknameChannel = alias(channels, CHANNEL_ALIAS);
const nicknameMember = alias(workspaceMembers, MEMBER_ALIAS);

/**
 * The nickname `userId` goes by in the workspace that owns `channelId`, or
 * `null` (no nickname, removed member, or a channel outside any workspace).
 */
export const channelMemberNicknameSql = (channelId: SQLWrapper, userId: SQLWrapper) =>
  sql<string | null>`(
    select ${memberNicknameSql(nicknameMember.config)}
    from ${workspaceMembers} ${sql.identifier(MEMBER_ALIAS)}
    inner join ${channels} ${sql.identifier(CHANNEL_ALIAS)} on ${nicknameChannel.workspaceId} = ${nicknameMember.workspaceId}
    where ${nicknameChannel.id} = ${channelId}
      and ${nicknameMember.userId} = ${userId}
      and ${nicknameMember.deletedAt} is null
  )`;

/**
 * A person's name as a channel shows it: their workspace nickname when set,
 * else their account full name. Drop-in for `users.fullName` in a select whose
 * row also carries the message's or member's channel id.
 */
export const channelUserNameSql = (channelId: SQLWrapper, userId: SQLWrapper): SQL<string | null> =>
  sql<string | null>`coalesce(${channelMemberNicknameSql(channelId, userId)}, ${users.fullName})`;
