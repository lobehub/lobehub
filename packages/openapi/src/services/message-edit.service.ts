import { omitServerOwnedMessageMetadata } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { messagePlugins, messages, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  assertCanUseMessageTargets,
  assertCanViewTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCreatorMessageTargets } from '@/server/routers/lambda/_helpers/shareVisitorTargetGuard';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';
import { MessageService as CoreMessageService } from '@/server/services/message';

import { BaseService } from '../common/base.service';
import { encodeOffsetCursor, resolvePagination } from '../helpers/pagination';
import type {
  MessageAddFilesRequest,
  MessageSearchHit,
  MessagesSearchQuery,
  MessageStatsQuery,
  MessageUpdateRequest,
} from '../types/message.type';

/**
 * Message edits, attachments, search and statistics for the REST API.
 *
 * Writes go through the server `MessageService` / `MessageModel` the tRPC
 * `message` router uses, behind the same guards: the RBAC permission, the
 * workspace General-access check on the owning conversation, and the refusal
 * to touch an agent-share visitor's message.
 */
export class MessageEditService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private get guardCtx() {
    return { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
  }

  private get core() {
    return new CoreMessageService(this.db, this.userId, this.workspaceId);
  }

  /** The message row the caller may update, or a 404. */
  private async findWritableMessage(messageId: string) {
    const permission = await this.resolveOperationPermission('MESSAGE_UPDATE', {
      targetMessageId: messageId,
    });
    if (!permission.isPermitted) {
      throw this.createAuthorizationError(permission.message || 'No permission to update message');
    }

    // The writes below go through the caller-scoped model, so resolve the row in
    // that same scope: a message only an `:all` reader can see is still a 404 here.
    const conditions = [eq(messages.id, messageId), this.buildWorkspaceWhere(messages)];

    const [row] = await this.db
      .select({
        id: messages.id,
        role: messages.role,
        toolCallId: messagePlugins.toolCallId,
        tools: messages.tools,
      })
      .from(messages)
      .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .where(and(...conditions))
      .limit(1);
    if (!row) throw this.createNotFoundError('Message not found');

    await assertCanUseMessageTargets(this.guardCtx, [messageId]);
    await assertCreatorMessageTargets(this.guardCtx, [messageId]);

    return row;
  }

  async updateMessage(messageId: string, patch: MessageUpdateRequest): Promise<void> {
    try {
      const row = await this.findWritableMessage(messageId);
      const isTool = row.role === 'tool';

      if ((patch.pluginState || patch.pluginError !== undefined) && !isTool) {
        throw this.createValidationError(
          '`pluginState` and `pluginError` apply to tool messages only',
        );
      }

      if (patch.toolArguments) {
        const { toolCallId } = patch.toolArguments;
        const calls = Array.isArray(row.tools) ? (row.tools as { id?: string }[]) : [];
        const ownsCall = isTool
          ? row.toolCallId === toolCallId
          : calls.some((tool) => tool.id === toolCallId);
        if (!ownsCall) {
          throw this.createValidationError(
            `Tool call ${toolCallId} is neither made nor answered by this message`,
          );
        }
      }

      const core = this.core;
      if (patch.content !== undefined)
        await core.updateMessage(messageId, { content: patch.content }, {});
      if (patch.metadata) {
        await core.updateMetadata(messageId, omitServerOwnedMessageMetadata(patch.metadata));
      }
      if (patch.pluginState) await core.updatePluginState(messageId, patch.pluginState, {});
      if (patch.pluginError !== undefined)
        await core.updatePluginError(messageId, patch.pluginError);
      if (patch.toolArguments) {
        const result = await core.updateToolArguments(
          patch.toolArguments.toolCallId,
          patch.toolArguments.arguments,
        );
        if (!result.success) {
          throw this.createBusinessError('The tool call has no stored result to update yet');
        }
      }
    } catch (error) {
      this.handleServiceError(error, 'Update message');
    }
  }

  async addFiles(messageId: string, { fileIds }: MessageAddFilesRequest): Promise<void> {
    try {
      await this.findWritableMessage(messageId);

      const result = await this.core.addFilesToMessage(messageId, fileIds);
      if (!result.success) {
        throw this.createBusinessError('Files could not be attached; check that every file exists');
      }
    } catch (error) {
      this.handleServiceError(error, 'Attach files to message');
    }
  }

  /**
   * Keyword search. Across the caller's history it uses the full-text search
   * backend (`searchByKeyword`); with `topicId` it is the literal find-in-topic
   * over that conversation's main line (`searchInTopic`).
   */
  async search(query: MessagesSearchQuery) {
    try {
      const permission = await this.resolveOperationPermission('MESSAGE_READ');
      if (!permission.isPermitted) {
        throw this.createAuthorizationError(permission.message || 'No permission to read messages');
      }

      const window = resolvePagination(query);

      if (query.topicId) {
        await assertCanViewTopicTargets(this.guardCtx, [query.topicId]);
        // `searchInTopic` has no offset: read up to the end of this page and slice.
        const model = new MessageModel(this.db, this.userId, this.workspaceId);
        const [topic, matches] = await Promise.all([
          this.db
            .select({ title: topics.title })
            .from(topics)
            .where(and(eq(topics.id, query.topicId), this.buildWorkspaceWhere(topics)))
            .limit(1)
            .then(([row]) => row),
          model.searchInTopic({
            keyword: query.q,
            limit: window.offset + window.limit + 1,
            topicId: query.topicId,
          }),
        ]);
        const page = matches.slice(window.offset, window.offset + window.limit);
        const topicId = query.topicId;
        const items: MessageSearchHit[] = page.map((match) => ({
          agentId: null,
          createdAt: match.createdAt.toISOString(),
          groupId: null,
          id: match.id,
          role: match.role,
          snippet: match.snippet,
          threadId: null,
          topicId,
          topicTitle: topic?.title ?? null,
        }));
        const hasMore = matches.length > window.offset + window.limit;
        return { items, ...this.pageInfo(window, items.length, hasMore) };
      }

      const ftsSearchRepo = await createFtsSearchRepo({
        db: this.db,
        usage: 'message_search',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      const result = await new MessageModel(
        this.db,
        this.userId,
        this.workspaceId,
        ftsSearchRepo,
      ).searchByKeyword({
        agentId: query.agentId,
        keyword: query.q,
        limit: window.limit,
        offset: window.offset,
      });
      const items: MessageSearchHit[] = result.items.map((item) => ({
        agentId: item.agentId,
        createdAt: item.createdAt.toISOString(),
        groupId: item.groupId,
        id: item.id,
        role: item.role,
        snippet: item.snippet,
        threadId: item.threadId,
        topicId: item.topicId,
        topicTitle: item.topicTitle,
      }));
      return { items, ...this.pageInfo(window, items.length, result.hasMore) };
    } catch (error) {
      this.handleServiceError(error, 'Search messages');
    }
  }

  private pageInfo(window: { limit: number; offset: number }, returned: number, hasMore: boolean) {
    return {
      hasMore,
      nextCursor: hasMore ? encodeOffsetCursor(window.offset + returned) : null,
    };
  }

  /** Distribution of message counts per topic, optionally scoped. */
  async topicStats(query: MessageStatsQuery) {
    try {
      const permission = await this.resolveOperationPermission('MESSAGE_READ');
      if (!permission.isPermitted) {
        throw this.createAuthorizationError(permission.message || 'No permission to read messages');
      }

      return new MessageModel(this.db, this.userId, this.workspaceId).topicMessageStats(query);
    } catch (error) {
      this.handleServiceError(error, 'Message statistics');
    }
  }
}
