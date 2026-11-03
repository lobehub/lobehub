import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { MessageService } from '../services/message.service';
import type {
  MessagesCountQuery,
  MessagesCreateRequest,
  MessagesDeleteBatchRequest,
  MessagesListQuery,
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

      return this.success(c, result, 'Message list retrieved successfully');
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
      await messageService.deleteMessage(id);

      return this.success(c, null, 'Message deleted successfully');
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
}
