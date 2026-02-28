import { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ChatService } from '../services/chat.service';
import {
  ChatServiceParams,
  MessageGenerationParams,
  TranslateServiceParams,
} from '../types/chat.type';

export class ChatController extends BaseController {
  /**
   * 通用聊天接口
   * POST /api/v1/chat
   * Body: ChatServiceParams
   */
  async handleChat(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const chatParams = (await this.getBody<ChatServiceParams>(c))!;

      const db = await this.getDatabase();
      const chatService = new ChatService(db, userId);

      // 如果是流式响应，直接返回
      if (chatParams.stream) {
        return await chatService.chat(chatParams);
      }

      const result = await chatService.chat(chatParams);
      return this.success(c, result, '聊天对话成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 翻译文本接口
   * POST /api/v1/chat/translate
   * Body: TranslateServiceParams
   */
  async handleTranslate(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const translateParams = (await this.getBody<TranslateServiceParams>(c))!;

      const db = await this.getDatabase();
      const chatService = new ChatService(db, userId);
      const result = await chatService.translate(translateParams);

      return this.success(c, { translatedText: result }, '翻译成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 生成消息回复接口
   * POST /api/v1/chat/generate-reply
   * Body: MessageGenerationParams
   */
  async handleGenerateReply(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const generationParams = (await this.getBody<MessageGenerationParams>(c))!;

      const db = await this.getDatabase();
      const chatService = new ChatService(db, userId);
      const result = await chatService.generateReply(generationParams);

      return this.success(c, { reply: result }, '生成回复成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
