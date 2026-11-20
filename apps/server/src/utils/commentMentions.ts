import { pickNonEmptyString, toRecord } from '@lobechat/utils/object';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

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

// Self-closing only, like the renderer: `<mention id="…">` never renders as one.
const MARKDOWN_MENTION_TAG = /<mention(\s[^>]*)\/>/gi;
// Same attribute forms the renderer accepts. Unquoted values matter: a shell
// strips the inner quotes of `lh task comment -m "<mention id="…" />"`.
const TAG_ATTRIBUTE = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;

const readMentionId = (attributes: string): string | undefined => {
  for (const [, key, doubleQuoted, singleQuoted, unquoted] of attributes.matchAll(TAG_ATTRIBUTE)) {
    if (key.toLowerCase() === 'id') return (doubleQuoted ?? singleQuoted ?? unquoted)?.trim();
  }
};

/**
 * Collect the member ids referenced by serialized `<mention name="…" id="…" />`
 * tags in a markdown comment body. This is the form the comment editor writes
 * for a mention, and the only way a markdown-only author (CLI, agent tools)
 * can address a member.
 */
export const extractMarkdownMentionedUserIds = (content: unknown): string[] => {
  if (typeof content !== 'string' || !content.includes('<mention')) return [];

  const userIds = new Set<string>();
  // Only raw HTML and prose can hold a mention; any code context (fenced,
  // indented, inline) renders literally, so the parsed tree skips it.
  visit(unified().use(remarkParse).parse(content), ['html', 'text'], (node) => {
    const { value } = node as { value?: unknown };
    if (typeof value !== 'string') return;
    for (const [, attributes] of value.matchAll(MARKDOWN_MENTION_TAG)) {
      const userId = readMentionId(attributes);
      if (userId) userIds.add(userId);
    }
  });
  return [...userIds];
};

/**
 * Mention candidates of a comment revision. The rich-text snapshot is the
 * source of truth when present (its markdown is derived from it); a
 * markdown-only revision falls back to its serialized mention tags.
 */
export const extractCommentMentionedUserIds = (comment: {
  content?: unknown;
  editorData?: unknown;
}): string[] =>
  comment.editorData
    ? extractMentionedUserIds(comment.editorData)
    : extractMarkdownMentionedUserIds(comment.content);

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

/**
 * Task-comment counterpart of `validateMentionedUserIds`: the revision may
 * only carry markdown (see `extractCommentMentionedUserIds`), and
 * `excludeUserId` is optional because an agent writing on a member's behalf
 * may @mention that member.
 */
export const validateTaskCommentMentionedUserIds = async (
  db: LobeChatDatabase,
  scope: { excludeUserId?: string; workspaceId: string },
  comment: { content?: unknown; editorData?: unknown },
): Promise<string[]> =>
  filterActiveWorkspaceMemberIds(
    db,
    scope.workspaceId,
    extractCommentMentionedUserIds(comment).filter((id) => id !== scope.excludeUserId),
  );
