import type { TrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';

/**
 * Resolve `--user` to a member's user id. Under a workspace scope the value is
 * matched against members by user id, email or username — usernames may start
 * with `user_` too, so the prefix alone never decides. Personal scope has no
 * member list, so only a raw `user_…` id is accepted there.
 */
export const resolveAssigneeUserId = async (client: TrpcClient, value: string) => {
  const needle = value.trim();

  if (!resolveWorkspaceId()) {
    if (needle.startsWith('user_')) return needle;
    throw new Error(
      `Cannot resolve "${needle}" outside a workspace — pass a user id (user_…) or run under a workspace scope.`,
    );
  }

  const members = await client.workspaceMember.list.query({});
  const byId = members.find((m) => m.userId === needle);
  if (byId) return byId.userId;

  const lower = needle.toLowerCase();
  const matches = members.filter(
    (m) => m.user?.email?.toLowerCase() === lower || m.user?.username?.toLowerCase() === lower,
  );

  if (matches.length === 1) return matches[0].userId;
  if (matches.length === 0) {
    throw new Error(
      `No workspace member matches "${needle}". Run \`lh workspace members\` to see who can be assigned.`,
    );
  }
  throw new Error(`"${needle}" matches ${matches.length} members — pass the user id instead.`);
};
