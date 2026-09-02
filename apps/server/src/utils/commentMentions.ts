import { pickNonEmptyString, toRecord } from '@lobechat/utils/object';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Collect the Workspace member ids referenced by `mention` nodes inside a
 * Lexical comment snapshot (`editorData`). Only `member`-typed mentions count;
 * Agent mentions and malformed nodes are ignored. Shared by every comment
 * surface (document / task) so mention semantics stay identical.
 */
export const extractMentionedUserIds = (editorData: unknown): string[] => {
  const root = toRecord(editorData)?.root;
  const pending: unknown[] = root === undefined ? [] : [root];
  const userIds = new Set<string>();

  while (pending.length > 0) {
    const node = toRecord(pending.pop());
    if (!node) continue;

    const metadata = toRecord(node.metadata);
    if (node.type === 'mention' && metadata?.type === 'member') {
      const userId = pickNonEmptyString(metadata.id);
      if (userId) userIds.add(userId);
    }

    if (Array.isArray(node.children)) pending.push(...node.children);
  }

  return [...userIds];
};

/**
 * Keep only the ids that are active members of the Workspace, preserving
 * order and dropping duplicates. Shared by the mention validator and by every
 * notification path whose recipients come from stored rows (a task's creator
 * or assignee) that can outlive membership.
 */
export const filterActiveWorkspaceMemberIds = async (
  db: LobeChatDatabase,
  workspaceId: string,
  userIds: string[],
): Promise<string[]> => {
  const candidateIds = [...new Set(userIds)];
  if (candidateIds.length === 0) return [];

  const activeMemberships = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, candidateIds),
        isNull(workspaceMembers.deletedAt),
      ),
    );
  const activeUserIds = new Set(activeMemberships.map(({ userId }) => userId));
  return candidateIds.filter((id) => activeUserIds.has(id));
};

/**
 * Narrow the mention candidates in `editorData` down to active members of the
 * given Workspace, dropping the actor themself. Mentions of ex-members or
 * arbitrary ids pasted into the editor never produce a notification.
 */
export const validateMentionedUserIds = async (
  db: LobeChatDatabase,
  scope: { actorUserId: string; workspaceId: string },
  editorData: unknown,
): Promise<string[]> =>
  filterActiveWorkspaceMemberIds(
    db,
    scope.workspaceId,
    extractMentionedUserIds(editorData).filter((id) => id !== scope.actorUserId),
  );
