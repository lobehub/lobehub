import type { CompressionGroupMetadata } from '@lobechat/types';
import { MessageGroupType } from '@lobechat/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { messageGroups, messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';

export interface CreateCompressionGroupParams {
  content: string;
  editorData?: any;
  messageIds: string[];
  metadata: CompressionGroupMetadata;
  sourceGroupIds?: string[];
  threadId?: string | null;
  topicId: string;
}

export interface FinalizeCompressionGroupParams {
  content: string;
  groupId: string;
  sourceGroupIds?: string[];
  threadId?: string | null;
  topicId: string;
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

  private threadScope = (threadId?: string | null) =>
    threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId);

  /** Lock and validate every dependency before changing any history. */
  private async assertGroupScope(
    tx: Pick<LobeChatDatabase, 'select'>,
    ids: string[],
    scope: { threadId?: string | null; topicId?: string },
    requireMembers = false,
  ) {
    if (!ids.length) return;
    const groups = await tx
      .select({ id: messageGroups.id })
      .from(messageGroups)
      .where(
        and(
          this.groupsOwnership(),
          inArray(messageGroups.id, ids),
          scope.topicId ? eq(messageGroups.topicId, scope.topicId) : undefined,
          eq(messageGroups.type, MessageGroupType.Compression),
        ),
      )
      .orderBy(messageGroups.id)
      .for('update');
    if (groups.length !== ids.length) throw new Error('Compression source group is unavailable');
    const members = await tx
      .select({
        id: messages.id,
        threadId: messages.threadId,
        topicId: messages.topicId,
        messageGroupId: messages.messageGroupId,
      })
      .from(messages)
      .where(and(this.messagesOwnership(), inArray(messages.messageGroupId, ids)))
      .for('update');
    if (
      members.some(
        (message) =>
          (scope.topicId && message.topicId !== scope.topicId) ||
          (message.threadId ?? null) !== (scope.threadId ?? null),
      ) ||
      (requireMembers &&
        ids.some((id) => !members.some((message) => message.messageGroupId === id)))
    )
      throw new Error('Compression source group belongs to another conversation');
  }

  /**
   * Create a compression group and mark messages as compressed
   */
  async createCompressionGroup(params: CreateCompressionGroupParams): Promise<string> {
    const { topicId, content, editorData, messageIds, metadata } = params;

    const selectedIds = [...new Set(messageIds)];
    return this.db.transaction(async (tx) => {
      await this.assertGroupScope(tx, [...new Set(params.sourceGroupIds ?? [])], params, true);
      if (selectedIds.length) {
        const selected = await tx
          .select({ id: messages.id, messageGroupId: messages.messageGroupId })
          .from(messages)
          .where(
            and(
              this.messagesOwnership(),
              eq(messages.topicId, topicId),
              this.threadScope(params.threadId),
              inArray(messages.id, selectedIds),
              notTrashed(messages.isDeleted),
            ),
          )
          .for('update');
        if (
          selected.length !== selectedIds.length ||
          selected.some((message) => message.messageGroupId)
        )
          throw new Error('Compression selection is unavailable or already grouped');
      }
      const [group] = await tx
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
        .returning({ id: messageGroups.id });
      if (selectedIds.length)
        await tx
          .update(messages)
          .set({ messageGroupId: group.id })
          .where(
            and(
              this.messagesOwnership(),
              eq(messages.topicId, topicId),
              inArray(messages.id, selectedIds),
            ),
          );
      return group.id;
    });
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
    const { content, groupId, topicId } = params;
    if (!content.trim()) throw new Error('Compression summary is empty');
    const requestedSourceGroupIds = [
      ...new Set((params.sourceGroupIds ?? []).filter((id) => id !== groupId)),
    ];

    await this.db.transaction(async (trx) => {
      await this.assertGroupScope(trx, [groupId, ...requestedSourceGroupIds].sort(), params);
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
        throw new Error(`Compression group not found: ${groupId}`);
      }

      if (requestedSourceGroupIds.length === 0) return;

      const sourceGroups = await trx
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
      const sourceGroupIds = sourceGroups.map((group) => group.id);

      if (sourceGroupIds.length !== requestedSourceGroupIds.length)
        throw new Error('Compression source group is unavailable');

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
  async deleteCompressionGroup(
    groupId: string,
    scope: { threadId?: string | null; topicId?: string } = {},
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.assertGroupScope(tx, [groupId], scope);
      await tx
        .update(messages)
        .set({ messageGroupId: null })
        .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)));

      // 2. Delete the group
      await tx
        .delete(messageGroups)
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
    });
  }
}
