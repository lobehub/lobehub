import type { ChatTopicMetadata } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { messageGroups, messages, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { copyMessagesInDatabase } from '../../utils/copyMessagesInDatabase';
import { idGenerator } from '../../utils/idGenerator';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Run configuration a branched topic keeps from its source. Everything else in
 * the metadata describes the source's own runs (native session ids, running
 * operation, summaries) and must not leak into the branch.
 */
const BRANCH_TOPIC_METADATA_KEYS = [
  'boundDeviceId',
  'heteroEffort',
  'reasoningConfig',
  'repos',
  'workingDirectory',
  'workingDirectoryConfig',
] as const satisfies readonly (keyof ChatTopicMetadata)[];
/**
 * Owns atomic writes spanning a topic and its copied conversation.
 *
 * Use when:
 * - Edit/resend must create a topic and message ancestry together.
 *
 * Expects:
 * - The caller's database and workspace scope.
 *
 * Returns:
 * - Scoped conversation operations with transaction-wide rollback.
 *
 * Call stack:
 *
 * topicRouter.branchTopicAtMessage
 *   -> TopicRepository.branchAtMessage
 *     -> {@link copyMessagesInDatabase}
 */
export class TopicRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private ownership = () =>
    and(
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
      notShareVisitorTopic(),
    );

  private messageOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);

  /**
   * Copies the conversation that leads up to one user message into a new
   * topic, ending at that message with replacement content: edit-and-resend
   * for runtimes whose native history cannot be rewound (Codex).
   *
   * The branch holds the message's ancestor chain plus every tool result of
   * the assistants on it; later turns and sibling branches stay behind, and
   * the source topic is untouched. The topic keeps its owner, project and run
   * configuration but none of the source's native session state, so the next
   * run starts a fresh session. One transaction: a failure leaves nothing.
   *
   * Use when:
   * - Editing a Codex user message starts a fresh topic and native session.
   *
   * Expects:
   * - An authorized source topic and a user-message boundary in that topic.
   *
   * Returns:
   * - The new topic and edited message, or undefined for an inaccessible boundary.
   *
   * Call stack:
   *
   * topicRouter.branchTopicAtMessage
   *   -> TopicRepository.branchAtMessage
   *     -> {@link copyMessagesInDatabase}
   */
  branchAtMessage = async (
    topicId: string,
    messageId: string,
    edit: { content: string; editorData?: Record<string, unknown> | null; title?: string },
  ) => {
    return this.db.transaction(async (tx) => {
      const source = await tx.query.topics.findFirst({
        where: and(eq(topics.id, topicId), this.ownership()),
      });
      if (!source) return;

      const rows = await tx
        .select({ id: messages.id, parentId: messages.parentId, role: messages.role })
        .from(messages)
        .where(and(eq(messages.topicId, topicId), this.messageOwnership()));
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (byId.get(messageId)?.role !== 'user') return;

      const keep = new Set<string>();
      let id: string | null | undefined = messageId;
      while (id && !keep.has(id)) {
        // Only IDs resolved inside the authorized source topic may reach the
        // copy map: a raw parent ID can refer to a different topic or owner.
        const ancestor = byId.get(id);
        if (!ancestor) break;
        keep.add(ancestor.id);
        id = ancestor.parentId;
      }
      for (const row of rows) {
        if (row.role === 'tool' && row.parentId && keep.has(row.parentId)) keep.add(row.id);
      }

      const metadata = Object.fromEntries(
        BRANCH_TOPIC_METADATA_KEYS.filter((key) => source.metadata?.[key] !== undefined).map(
          (key) => [key, source.metadata?.[key]],
        ),
      ) as ChatTopicMetadata;
      // Marks the copy so only this topic's fresh local run replays its history.
      metadata.editedFrom = { messageId, topicId };
      const [branch] = await tx
        .insert(topics)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              agentId: source.agentId,
              groupId: source.groupId,
              id: idGenerator('topics'),
              metadata,
              model: source.model,
              projectId: source.projectId,
              projectWorkingDirectoryId: source.projectWorkingDirectoryId,
              provider: source.provider,
              sessionId: source.sessionId,
              title: edit.title || source.title,
            },
          ),
        )
        .returning();

      const messageIdPairs = [...keep].map(
        (id) => [id, idGenerator('messages')] as [string, string],
      );
      await copyMessagesInDatabase({
        agentIdExpr: sql`${messages.agentId}`,
        childScope: (table) =>
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, table),
        executor: tx,
        groupId: source.groupId,
        messageIdPairs,
        targetIdExpr: sql`${messages.targetId}`,
        targetUserId: this.userId,
        targetWorkspaceId: this.workspaceId ?? null,
        // Thread rows on the chain join the branch's main conversation.
        threadIdPairs: [],
        topicIdPairs: [[topicId, branch.id]],
      });
      // Keep referenced groups and their ancestor closure. Deleting an empty
      // parent would cascade into its retained descendants and their messages.
      // UNION deduplicates groups so a malformed cycle cannot recurse forever.
      await tx.execute(sql`
        with recursive retained_groups(id, parent_group_id) as (
          select ${messageGroups.id}, ${messageGroups.parentGroupId}
          from ${messageGroups}
          where ${messageGroups.topicId} = ${branch.id}
            and exists (
              select 1 from ${messages} where ${messages.messageGroupId} = ${messageGroups.id}
            )
          union
          select ${messageGroups.id}, ${messageGroups.parentGroupId}
          from ${messageGroups}
          join retained_groups on ${messageGroups.id} = retained_groups.parent_group_id
          where ${messageGroups.topicId} = ${branch.id}
        )
        delete from ${messageGroups}
        where ${messageGroups.topicId} = ${branch.id}
          and ${messageGroups.id} not in (select id from retained_groups)
      `);

      const branchMessageId = messageIdPairs.find(([sourceId]) => sourceId === messageId)![1];
      await tx
        .update(messages)
        .set({
          content: edit.content,
          ...(edit.editorData !== undefined && { editorData: edit.editorData }),
        })
        .where(eq(messages.id, branchMessageId));

      return { messageId: branchMessageId, topic: branch };
    });
  };
}
