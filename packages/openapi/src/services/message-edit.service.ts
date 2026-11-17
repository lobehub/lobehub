import { TOPIC_MESSAGE_SEARCH_LIMIT } from '@lobechat/const';
import { omitServerOwnedMessageMetadata } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
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

  /** Server guards throw `TRPCError`; the controller maps its code to the HTTP status. */
  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError) throw error;
    this.handleServiceError(error, operation);
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
      .select({ id: messages.id, role: messages.role, tools: messages.tools })
      .from(messages)
      .where(and(...conditions))
      .limit(1);
    if (!row) throw this.createNotFoundError('Message not found');

    await assertCanUseMessageTargets(this.guardCtx, [messageId]);
    await assertCreatorMessageTargets(this.guardCtx, [messageId]);

    return row;
  }

  /**
   * The single stored tool result `toolCallId` resolves to, once it is tied to
   * `message` (the call it made, or the call it answers). The model rewrites
   * arguments by `toolCallId` alone, so an id shared by two results is refused
   * rather than letting the write land on a pair this request never guarded.
   */
  private async assertToolCallOfMessage(
    message: { id: string; role: string; tools: unknown },
    toolCallId: string,
  ) {
    const results = await this.db
      .select({ id: messagePlugins.id, parentId: messages.parentId })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .where(and(eq(messagePlugins.toolCallId, toolCallId), this.buildWorkspaceWhere(messages)))
      .limit(2);

    if (results.length > 1) {
      throw this.createConflictError(
        `Tool call id ${toolCallId} is shared by several tool results and cannot be edited`,
      );
    }

    const calls = Array.isArray(message.tools) ? (message.tools as { id?: string }[]) : [];
    const [result] = results;
    const owned =
      message.role === 'tool'
        ? result?.id === message.id
        : calls.some((tool) => tool.id === toolCallId) && result?.parentId === message.id;
    if (!owned) {
      throw this.createValidationError(
        `Tool call ${toolCallId} has no stored result made or answered by this message`,
      );
    }
  }

  /**
   * Applies every field of the patch. All checks run before the first write,
   * and a tool message's fields commit in one transaction (`updateToolMessage`).
   */
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
        await this.assertToolCallOfMessage(row, patch.toolArguments.toolCallId);
      }

      const core = this.core;
      const metadata = patch.metadata && omitServerOwnedMessageMetadata(patch.metadata);

      if (isTool) {
        const { content, pluginError, pluginState } = patch;
        if ([content, metadata, pluginError, pluginState].some((field) => field !== undefined)) {
          const result = await core.updateToolMessage(messageId, {
            content,
            metadata,
            pluginError,
            pluginState,
          });
          if (!result.success) throw this.createNotFoundError('Message not found');
        }
      } else {
        if (patch.content !== undefined) {
          await core.updateMessage(messageId, { content: patch.content }, {});
        }
        if (metadata) await core.updateMetadata(messageId, metadata);
      }

      if (patch.toolArguments) {
        await core.updateToolArguments(
          patch.toolArguments.toolCallId,
          patch.toolArguments.arguments,
        );
      }
    } catch (error) {
      this.fail(error, 'Update message');
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
      this.fail(error, 'Attach files to message');
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
        // `searchInTopic` has no offset: read up to the end of this page and slice,
        // never past the first TOPIC_MESSAGE_SEARCH_LIMIT matches the UI's find also stops at.
        const windowEnd = Math.min(window.offset + window.limit, TOPIC_MESSAGE_SEARCH_LIMIT);
        const model = new MessageModel(this.db, this.userId, this.workspaceId);
        const [topic, matches] = await Promise.all([
          this.db
            .select({ title: topics.title })
            .from(topics)
            .where(and(eq(topics.id, query.topicId), this.buildWorkspaceWhere(topics)))
            .limit(1)
            .then(([row]) => row),
          model.searchInTopic({ keyword: query.q, limit: windowEnd + 1, topicId: query.topicId }),
        ]);
        const page = matches.slice(window.offset, windowEnd);
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
        const hasMore = windowEnd < TOPIC_MESSAGE_SEARCH_LIMIT && matches.length > windowEnd;
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
      this.fail(error, 'Search messages');
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
      this.fail(error, 'Message statistics');
    }
  }
}
