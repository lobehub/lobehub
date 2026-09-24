import type { TrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';

/**
 * Resolve `--user` to a member's user id. A raw `user_…` id passes through;
 * anything else is matched against the active workspace's members by email or
 * username, so `--user neko@ayaka.moe` works without looking the id up first.
 */
export const resolveAssigneeUserId = async (client: TrpcClient, value: string) => {
  const needle = value.trim();
  if (needle.startsWith('user_')) return needle;

  if (!resolveWorkspaceId()) {
    throw new Error(
      `Cannot resolve "${needle}" outside a workspace — pass a user id (user_…) or run under a workspace scope.`,
    );
  }

  const members = await client.workspaceMember.list.query({});
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
