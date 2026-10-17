import type { CompressionGroupMetadata } from '@lobechat/types';
import { MessageGroupType } from '@lobechat/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { MessageGroupItem } from '../../schemas';
import { messageGroups, messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export interface CreateCompressionGroupParams {
  content: string;
  editorData?: any;
  messageIds: string[];
  metadata: CompressionGroupMetadata;
  topicId: string;
}

export interface FinalizeCompressionGroupParams {
  content: string;
  groupId: string;
  /**
   * Fail with {@link CompressionConflictError} instead of folding in whatever
   * is left when the group or any source group is gone — i.e. a concurrent
   * compaction of the same scope already finalized over them.
   */
  requireSourceGroups?: boolean;
  sourceGroupIds?: string[];
  topicId: string;
}

/** Content of a compression group whose summary is still being generated. */
export const COMPRESSION_PLACEHOLDER_CONTENT = '...';

/**
 * Another compaction of the same conversation claimed these messages or
 * superseded these groups first. Nothing was written by the losing call.
 */
export class CompressionConflictError extends Error {
  constructor(message = 'Context compaction already in progress') {
    super(message);
    this.name = 'CompressionConflictError';
  }
}

export interface CompressionGroupResult {
  content: string | null;
  createdAt: Date;
  description: string | null;
  editorData: unknown;
  id: string;
  metadata: CompressionGroupMetadata | null;
  topicId: string | null;
  type: string | null;
}

/**
 * Compression Repository - handles message compression operations
 */
export class CompressionRepository {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private groupsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageGroups);

  private messagesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);

  /**
   * Create a compression group and mark messages as compressed
   */
  async createCompressionGroup(params: CreateCompressionGroupParams): Promise<string> {
    const { topicId, content, editorData, messageIds, metadata } = params;

    // Store metadata in the description field as JSON string
    const description = JSON.stringify(metadata);

    // 1. Create compression group
    const result = (await this.db
      .insert(messageGroups)
      .values({
        content,
        description,
        editorData,
        topicId,
        type: MessageGroupType.Compression,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning()) as MessageGroupItem[];

    const group = result[0];

    // 2. Mark messages as compressed
    if (messageIds.length > 0) {
      await this.markMessagesAsCompressed(messageIds, group.id);
    }

    return group.id;
  }

  /**
   * Create a compression group only if every message is still uncompressed.
   *
   * Two compactions that read the same history both snapshot the same live
   * ids; the plain {@link createCompressionGroup} would let the second steal
   * the first one's members and leave an empty group behind. Here the claim is
   * conditional (`message_group_id IS NULL`) and all-or-nothing: the row locks
   * taken by the first claim make a concurrent second claim re-check after the
   * first commits, so it sees the rows taken and rolls back.
   *
   * @returns the group id, or `null` when any message was already claimed.
   */
  async claimCompressionGroup(params: CreateCompressionGroupParams): Promise<string | null> {
    const { topicId, content, editorData, metadata } = params;
    const messageIds = [...new Set(params.messageIds)];

    try {
      return await this.db.transaction(async (trx) => {
        const [group] = (await trx
          .insert(messageGroups)
          .values({
            content,
            description: JSON.stringify(metadata),
            editorData,
            topicId,
            type: MessageGroupType.Compression,
            userId: this.userId,
            workspaceId: this.workspaceId ?? null,
          })
          .returning()) as MessageGroupItem[];

        if (messageIds.length === 0) return group.id;

        const claimed = await trx
          .update(messages)
          .set({ messageGroupId: group.id })
          .where(
            and(
              this.messagesOwnership(),
              eq(messages.topicId, topicId),
              inArray(messages.id, messageIds),
              isNull(messages.messageGroupId),
            ),
          )
          .returning({ id: messages.id });

        // Rolls back the group insert and any partial claim.
        if (claimed.length !== messageIds.length) throw new CompressionConflictError();

        return group.id;
      });
    } catch (error) {
      if (error instanceof CompressionConflictError) return null;
      throw error;
    }
  }

  /**
   * Get all compression groups for a topic
   */
  async getCompressionGroups(topicId: string): Promise<CompressionGroupResult[]> {
    const groups = await this.db
      .select()
      .from(messageGroups)
      .where(
        and(
          this.groupsOwnership(),
          eq(messageGroups.topicId, topicId),
          eq(messageGroups.type, MessageGroupType.Compression),
        ),
      )
      .orderBy(messageGroups.createdAt);

    // Parse description field as metadata
    return groups.map((group) => ({
      ...group,
      metadata: group.description ? JSON.parse(group.description) : null,
    })) as unknown as CompressionGroupResult[];
  }

  /**
   * Get the latest compression group for a topic
   */
  async getLatestCompressionGroup(topicId: string): Promise<CompressionGroupResult | null> {
    const groups = await this.getCompressionGroups(topicId);
    return groups.length > 0 ? groups.at(-1)! : null;
  }

  /**
   * Update compression group content
   */
  async updateCompressionContent(
    groupId: string,
    content: string,
    metadata?: Partial<CompressionGroupMetadata>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      content,
      updatedAt: new Date(),
    };

    if (metadata) {
      // Need to merge with existing metadata
      const existing = await this.db
        .select({ description: messageGroups.description })
        .from(messageGroups)
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

      const existingMetadata = existing[0]?.description ? JSON.parse(existing[0].description) : {};
      updateData.description = JSON.stringify({ ...existingMetadata, ...metadata });
    }

    await this.db
      .update(messageGroups)
      .set(updateData)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }

  /**
   * Finalize a new compression group and atomically supersede prior groups.
   * Source messages move before their old groups are deleted so the cascade
   * never removes conversation history.
   */
  async finalizeCompressionGroup(params: FinalizeCompressionGroupParams): Promise<void> {
    const { content, groupId, requireSourceGroups, topicId } = params;
    const requestedSourceGroupIds = [
      ...new Set((params.sourceGroupIds ?? []).filter((id) => id !== groupId)),
    ];

    await this.db.transaction(async (trx) => {
      const finalizedGroups = await trx
        .update(messageGroups)
        .set({ content, updatedAt: new Date() })
        .where(
          and(
            eq(messageGroups.id, groupId),
            eq(messageGroups.topicId, topicId),
            eq(messageGroups.type, MessageGroupType.Compression),
            this.groupsOwnership(),
          ),
        )
        .returning({ id: messageGroups.id });

      if (finalizedGroups.length === 0) {
        if (requireSourceGroups) throw new CompressionConflictError();
        throw new Error(`Compression group not found: ${groupId}`);
      }

      if (requestedSourceGroupIds.length === 0) return;

      const sourceGroupsQuery = trx
        .select({ id: messageGroups.id })
        .from(messageGroups)
        .where(
          and(
            inArray(messageGroups.id, requestedSourceGroupIds),
            eq(messageGroups.topicId, topicId),
            eq(messageGroups.type, MessageGroupType.Compression),
            this.groupsOwnership(),
          ),
        );
      // Locking the source groups makes a concurrent finalize over the same
      // groups wait for this one, then see them deleted and give up.
      const sourceGroups = requireSourceGroups
        ? await sourceGroupsQuery.for('update')
        : await sourceGroupsQuery;
      const sourceGroupIds = sourceGroups.map((group) => group.id);

      if (requireSourceGroups && sourceGroupIds.length !== requestedSourceGroupIds.length) {
        throw new CompressionConflictError();
      }

      if (sourceGroupIds.length === 0) return;

      await trx
        .update(messages)
        .set({ messageGroupId: groupId })
        .where(
          and(
            this.messagesOwnership(),
            eq(messages.topicId, topicId),
            inArray(messages.messageGroupId, sourceGroupIds),
          ),
        );

      await trx
        .delete(messageGroups)
        .where(and(this.groupsOwnership(), inArray(messageGroups.id, sourceGroupIds)));
    });
  }

  /**
   * Update compression group metadata (UI state like expanded)
   */
  async updateMetadata(
    groupId: string,
    metadata: Partial<CompressionGroupMetadata>,
  ): Promise<void> {
    // Get existing metadata and merge
    const existing = await this.db
      .select({ metadata: messageGroups.metadata })
      .from(messageGroups)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

    const existingData = (existing[0]?.metadata as Record<string, unknown>) || {};
    const newMetadata = { ...existingData, ...metadata };

    await this.db
      .update(messageGroups)
      .set({ metadata: newMetadata, updatedAt: new Date() })
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }

  /**
   * Mark messages as compressed by associating them with a compression group
   */
  async markMessagesAsCompressed(messageIds: string[], groupId: string): Promise<void> {
    if (messageIds.length === 0) return;

    await this.db
      .update(messages)
      .set({ messageGroupId: groupId })
      .where(and(this.messagesOwnership(), inArray(messages.id, messageIds)));
  }

  /**
   * Unmark messages from compression (remove from compression group)
   */
  async unmarkMessagesFromCompression(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    await this.db
      .update(messages)
      .set({ messageGroupId: null })
      .where(and(this.messagesOwnership(), inArray(messages.id, messageIds)));
  }

  /**
   * Toggle pin status for a message
   */
  async toggleMessagePin(messageId: string, pinned: boolean): Promise<void> {
    // Get current metadata
    const [message] = await this.db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(and(eq(messages.id, messageId), this.messagesOwnership()));

    if (!message) return;

    const currentMetadata = (message.metadata as Record<string, unknown>) || {};
    const newMetadata = { ...currentMetadata, pinned };

    await this.db
      .update(messages)
      .set({ metadata: newMetadata })
      .where(and(eq(messages.id, messageId), this.messagesOwnership()));
  }

  /**
   * Narrow compression groups to those that belong to the given thread scope
   * (`threadId` null = the topic's main line). Group rows only carry a
   * `topicId`, so a topic-wide group list mixes the main line with its threads.
   *
   * A thread group may also hold the main-line parents the thread branched
   * from, so ownership is decided by thread membership, not by any single row:
   * a group belongs to thread T when any member is in T, and to the main line
   * only when none of its members is in a thread.
   */
  async filterGroupIdsByThread(
    groupIds: string[],
    params: { threadId?: string | null; topicId: string },
  ): Promise<string[]> {
    if (groupIds.length === 0) return [];

    const { threadId, topicId } = params;
    const rows = await this.db
      .selectDistinct({ messageGroupId: messages.messageGroupId, threadId: messages.threadId })
      .from(messages)
      .where(
        and(
          this.messagesOwnership(),
          eq(messages.topicId, topicId),
          inArray(messages.messageGroupId, groupIds),
        ),
      );

    const inScope = new Set<string>();
    const inAnyThread = new Set<string>();
    for (const row of rows) {
      if (!row.messageGroupId) continue;
      if (row.threadId) inAnyThread.add(row.messageGroupId);
      if (threadId ? row.threadId === threadId : !row.threadId) inScope.add(row.messageGroupId);
    }

    return groupIds.filter((id) => inScope.has(id) && (!!threadId || !inAnyThread.has(id)));
  }

  /**
   * Get messages that are not compressed (for sending to LLM)
   */
  async getUncompressedMessages(topicId: string) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          this.messagesOwnership(),
          eq(messages.topicId, topicId),
          isNull(messages.messageGroupId),
        ),
      )
      .orderBy(messages.createdAt);
  }

  /**
   * Get compressed messages for a specific compression group
   */
  async getCompressedMessages(groupId: string) {
    return this.db
      .select()
      .from(messages)
      .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)))
      .orderBy(messages.createdAt);
  }

  /**
   * Delete a compression group and unmark all associated messages
   */
  async deleteCompressionGroup(groupId: string): Promise<void> {
    // 1. Unmark all messages
    await this.db
      .update(messages)
      .set({ messageGroupId: null })
      .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)));

    // 2. Delete the group
    await this.db
      .delete(messageGroups)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }
}
