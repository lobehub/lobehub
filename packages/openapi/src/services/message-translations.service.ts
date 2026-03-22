import { eq } from 'drizzle-orm';

import { messages, messageTranslates } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import { removeSystemContext } from '../helpers/translate';
import type { ServiceResult } from '../types';
import type {
  MessageTranslateInfoUpdate,
  MessageTranslateResponse,
  MessageTranslateTriggerRequest,
} from '../types/message-translations.type';
import { ChatService } from './chat.service';

type MessageTranslateItem = typeof messageTranslates.$inferSelect;

export class MessageTranslateService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * Get translation info by message ID
   * @param messageId Message ID
   * @returns Translation info
   */
  async getTranslateByMessageId(messageId: string): ServiceResult<MessageTranslateResponse | null> {
    // Permission check is already done in the route layer (MESSAGE_READ + TRANSLATION_READ)

    this.log('info', '根据消息ID获取翻译信息', { messageId, userId: this.userId });

    try {
      const result = await this.db.query.messageTranslates.findFirst({
        where: eq(messageTranslates.id, messageId),
      });

      if (!result) {
        this.log('info', '未找到翻译信息', { messageId });
        return null;
      }

      const response: MessageTranslateResponse = {
        clientId: result.clientId,
        content: result.content,
        from: result.from,
        id: result.id,
        to: result.to,
        userId: result.userId,
      };

      this.log('info', '获取翻译信息完成', { messageId });
      return response;
    } catch (error) {
      this.handleServiceError(error, '根据消息ID获取翻译信息');
    }
  }

  /**
   * Create or update message translation
   * @param translateData Translation data
   * @returns Translation result
   */
  async translateMessage(
    translateData: MessageTranslateTriggerRequest,
  ): ServiceResult<Partial<MessageTranslateItem>> {
    // Permission check is already done in the route layer (MESSAGE_READ + TRANSLATION_CREATE)

    this.log('info', '开始翻译消息', {
      ...translateData,
      userId: this.userId,
    });

    try {
      // First fetch the original message content and sessionId
      const messageInfo = await this.db.query.messages.findFirst({
        where: eq(messages.id, translateData.messageId),
      });

      if (!messageInfo) {
        throw this.createCommonError('未找到要翻译的消息');
      }

      this.log('info', '原始消息内容', { originalMessage: messageInfo.content });

      // Use ChatService for translation, passing sessionId to use the correct model configuration
      const chatService = new ChatService(this.db, this.userId);
      const translatedContent = await chatService.translate({
        ...translateData,
        sessionId: messageInfo.sessionId,
        text: removeSystemContext(messageInfo.content),
      });

      // Use updateTranslateInfo to update translation content
      return this.updateTranslateInfo({
        from: translateData.from,
        messageId: translateData.messageId,
        to: translateData.to,
        content: translatedContent,
      });
    } catch (error) {
      this.handleServiceError(error, '翻译消息');
    }
  }

  /**
   * Update message translation info
   * @param data Translation info update data
   * @returns Updated translation result
   */
  async updateTranslateInfo(
    data: MessageTranslateInfoUpdate,
  ): ServiceResult<Partial<MessageTranslateItem>> {
    // Permission check is already done in the route layer (MESSAGE_UPDATE + TRANSLATION_UPDATE)

    try {
      // Check if message exists
      const messageInfo = await this.db.query.messages.findFirst({
        where: eq(messages.id, data.messageId),
      });
      if (!messageInfo) {
        throw this.createCommonError('未找到要更新翻译信息的消息');
      }

      // Update translation info and content
      await this.db
        .insert(messageTranslates)
        .values({
          content: data.content,
          from: data.from,
          id: data.messageId,
          to: data.to,
          userId: this.userId,
        })
        .onConflictDoUpdate({
          set: {
            content: data.content,
            from: data.from,
            to: data.to,
          },
          target: messageTranslates.id,
        });

      this.log('info', '更新翻译信息完成', { messageId: data.messageId });

      return {
        content: data.content,
        from: data.from,
        id: data.messageId,
        to: data.to,
        userId: this.userId,
      };
    } catch (error) {
      this.handleServiceError(error, '更新翻译信息');
    }
  }

  /**
   * Delete translation info for the specified message
   * @param messageId Message ID
   * @returns Deletion result
   */
  async deleteTranslateByMessageId(
    messageId: string,
  ): ServiceResult<{ deleted: boolean; messageId: string }> {
    // Permission check is already done in the route layer (TRANSLATION_DELETE)

    try {
      // Check if the translation message exists
      const originalTranslation = await this.db.query.messageTranslates.findFirst({
        where: eq(messageTranslates.id, messageId),
      });

      if (!originalTranslation) {
        throw this.createNotFoundError('翻译消息不存在');
      }

      await this.db.delete(messageTranslates).where(eq(messageTranslates.id, messageId));

      return { deleted: true, messageId };
    } catch (error) {
      this.handleServiceError(error, '删除翻译信息');
    }
  }
}
