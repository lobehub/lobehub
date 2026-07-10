import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { MessageTranslateService } from '../services/message-translations.service';
import type {
  MessageTranslateBody,
  MessageTranslateInfoUpdate,
  MessageTranslateParams,
} from '../types/message-translations.type';

export class MessageTranslationController extends BaseController {
  /**
   * Retrieves translation information for a specific message
   * GET /api/v1/message_translates/:messageId
   * Param: { messageId: string }
   */
  async handleGetTranslateByMessage(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { messageId } = this.getParams<{ messageId: string }>(c);

      const db = await this.getDatabase();
      const translateService = new MessageTranslateService(db, userId, this.getWorkspaceId(c));
      const translate = await translateService.getTranslateByMessageId(messageId);

      return this.success(c, translate, 'Translation info retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Translates a specific message
   * POST /api/v1/message_translates/:messageId
   * Body: { from?: string, to: string }
   */
  async handleTranslateMessage(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { messageId } = this.getParams<MessageTranslateParams>(c);
      const translatePayload = (await this.getBody<MessageTranslateBody>(c))!;

      const db = await this.getDatabase();
      const translateService = new MessageTranslateService(db, userId, this.getWorkspaceId(c));
      const result = await translateService.translateMessage({
        messageId,
        ...translatePayload,
      });

      return this.success(c, result, 'Message translated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates message translation information
   * PUT /api/v1/message-translates/:messageId
   * Body: { from: string, to: string, content: string }
   */
  async handleUpdateTranslateInfo(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { messageId } = this.getParams<{ messageId: string }>(c);
      const configData = (await this.getBody<MessageTranslateInfoUpdate>(c))!;

      const db = await this.getDatabase();
      const translateService = new MessageTranslateService(db, userId, this.getWorkspaceId(c));
      const result = await translateService.updateTranslateInfo({ ...configData, messageId });

      return this.success(c, result, 'Translation info updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes translation information for a message
   * DELETE /api/v1/message-translates/:messageId
   */
  async handleDeleteTranslate(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { messageId } = this.getParams<{ messageId: string }>(c);

      const db = await this.getDatabase();
      const translateService = new MessageTranslateService(db, userId, this.getWorkspaceId(c));
      const result = await translateService.deleteTranslateByMessageId(messageId);

      return this.success(c, result, 'Translation info deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
