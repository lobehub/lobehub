import { canWorkspaceRoleBeTaskAssignee } from '@lobechat/const/rbac';

import type { TrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';

/**
 * Resolve `--user` to a member's user id. Under a workspace scope the value is
 * matched against members by user id, email or username — usernames may start
 * with `user_` too, so the prefix alone never decides. Personal scope has no
 * member list, so only a raw `user_…` id is accepted there.
 *
 * Only members whose role can own tasks are candidates, mirroring the server's
 * assignee check, so a viewer neither resolves nor makes an eligible match
 * ambiguous.
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
  const lower = needle.toLowerCase();
  const matches = members.filter(
    (m) =>
      m.userId === needle ||
      m.user?.email?.toLowerCase() === lower ||
      m.user?.username?.toLowerCase() === lower,
  );
  // An exact user id wins over an email/username that happens to equal it.
  const byId = matches.find((m) => m.userId === needle);
  const candidates = byId ? [byId] : matches;
  const eligible = candidates.filter((m) => canWorkspaceRoleBeTaskAssignee(m.role));

  if (eligible.length === 1) return eligible[0].userId;
  if (eligible.length > 1) {
    throw new Error(`"${needle}" matches ${eligible.length} members — pass the user id instead.`);
  }
  if (candidates.length > 0) {
    throw new Error(
      `"${needle}" is a ${candidates[0].role} in this workspace and can't be assigned tasks.`,
    );
  }
  throw new Error(
    `No workspace member matches "${needle}". Run \`lh workspace members\` to see who can be assigned.`,
  );
};
