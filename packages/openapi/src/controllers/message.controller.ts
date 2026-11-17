import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { MessageService } from '../services/message.service';
import { MessageEditService } from '../services/message-edit.service';
import type { DeletedResource } from '../types/common.type';
import type {
  MessageAddFilesRequest,
  MessagesCountQuery,
  MessagesCreateRequest,
  MessagesDeleteBatchRequest,
  MessagesListQuery,
  MessagesSearchQuery,
  MessageStatsQuery,
  MessageUpdateRequest,
} from '../types/message.type';

export class MessageController extends BaseController {
  /**
   * Unified message count endpoint (RESTful API optimized)
   * GET /api/v1/messages/count
   * Query: { topicIds?: string, userId?: string }
   */
  async handleCountMessages(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const rawQuery = this.getQuery(c);

      // Process topicIds parameter (comma-separated string -> array)
      const processedQuery: MessagesCountQuery = {
        ...rawQuery,
        topicIds: rawQuery.topicIds ? (rawQuery.topicIds as string).split(',') : undefined,
      };

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const result = await messageService.countMessages(processedQuery);

      return this.success(c, result, 'Message count retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Unified message list query endpoint (RESTful API optimized)
   * GET /api/v1/messages
   * Query: { page?, limit?, topicId?, userId?, role?, query?, sort?, order? }
   */
  async handleGetMessages(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const request = this.getQuery<MessagesListQuery>(c);

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const result = await messageService.getMessages(request);

      return this.list(c, 'messages', result, {
        message: 'Message list retrieved successfully',
        pagination: request,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves message details by message ID
   * GET /api/v1/messages/:id
   * Params: { id: string }
   */
  async handleGetMessageById(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams<{ id: string }>(c);

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const message = await messageService.getMessageById(id);

      if (!message) {
        return this.error(c, 'Message not found or access denied', 404);
      }

      return this.success(c, message, 'Message details retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a new message
   * POST /api/v1/messages
   * Body: { content: string, role: 'user'|'assistant'|'system'|'tool', topicId?: string, model?: string, provider?: string, files?: string[] }
   */
  async handleCreateMessage(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const messageData = (await this.getBody<MessagesCreateRequest>(c))!;

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const result = await messageService.createMessage(messageData);

      return this.success(c, result, 'Message created successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a user message and generates an AI reply
   * POST /api/v1/messages/replies
   * Body: { content: string, role: 'user', topicId?: string, model?: string, provider?: string, files?: string[] }
   */
  async handleCreateMessageWithAIReply(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const messageData = (await this.getBody<MessagesCreateRequest>(c))!;

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const result = await messageService.createMessageWithAIReply(messageData);

      return this.success(c, result, 'Message created and AI reply generated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes a single message
   * DELETE /api/v1/messages/:id
   * Params: { id: string }
   */
  async handleDeleteMessage(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams<{ id: string }>(c);

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const removed = await messageService.deleteMessage(id);
      if (!removed) return this.error(c, 'Message not found', 404);

      return this.success<DeletedResource>(
        c,
        { deleted: true, id },
        'Message deleted successfully',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Batch deletes messages
   * DELETE /api/v1/messages
   * Body: { messageIds: string[] }
   */
  async handleDeleteBatchMessages(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { messageIds } = (await this.getBody<MessagesDeleteBatchRequest>(c))!;

      const db = await this.getDatabase();
      const messageService = new MessageService(db, userId, this.getWorkspaceId(c));
      const result = await messageService.deleteBatchMessages(messageIds);

      return this.success(c, result, 'Messages deleted in batch successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  private async editService(c: Context) {
    return new MessageEditService(
      await this.getDatabase(),
      this.getUserId(c)!,
      this.getWorkspaceId(c),
    );
  }

  /** The message as `GET /messages/:id` answers it, after a write. */
  private async readBack(c: Context, id: string) {
    const db = await this.getDatabase();
    return new MessageService(db, this.getUserId(c)!, this.getWorkspaceId(c)).getMessageById(id);
  }

  /**
   * Edits a message: content, metadata, tool state/error and tool arguments
   * PATCH /api/v1/messages/:id
   */
  async handleUpdateMessage(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const patch = await this.getBody<MessageUpdateRequest>(c);

      await (await this.editService(c)).updateMessage(id, patch);

      return this.success(c, await this.readBack(c, id), 'Message updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Attaches uploaded files to a message
   * POST /api/v1/messages/:id/files
   */
  async handleAddFiles(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<MessageAddFilesRequest>(c);

      await (await this.editService(c)).addFiles(id, body);

      return this.success(c, await this.readBack(c, id), 'Files attached successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Keyword search across messages, or within one topic
   * GET /api/v1/messages/search
   */
  async handleSearchMessages(c: Context) {
    try {
      const query = this.getQuery<MessagesSearchQuery>(c);
      const result = await (await this.editService(c)).search(query);

      return this.success(c, result, 'Messages searched successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Distribution of message counts per topic
   * GET /api/v1/messages/stats
   */
  async handleTopicStats(c: Context) {
    try {
      const query = this.getQuery<MessageStatsQuery>(c);
      const result = await (await this.editService(c)).topicStats(query);

      return this.success(c, result, 'Message statistics retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
