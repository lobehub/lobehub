import type {
  MessageTransport,
  QueryMessagesInput,
  RuntimeMessageRef,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';

import { type MessageModel } from '@/database/models/message';

import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
} from '../messagePersistErrors';

/**
 * Server {@link MessageTransport} adapter — delegates to `MessageModel` (DB).
 */
export class ServerMessageTransport implements MessageTransport {
  constructor(private readonly messageModel: MessageModel) {}

  createAssistantMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    return this.messageModel.create(params);
  }

  async createToolMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    try {
      return await this.messageModel.create(params);
    } catch (error) {
      if (typeof params.parentId === 'string' && isMidOperationReferenceMissingError(error)) {
        throw createConversationParentMissingError(params.parentId, error);
      }
      throw error;
    }
  }

  async deleteMessage(id: string): Promise<void> {
    await this.messageModel.deleteMessage(id);
  }

  async findById(id: string): Promise<RuntimeMessageRef | undefined> {
    const message = await this.messageModel.findById(id);
    return message ? { id: message.id } : undefined;
  }

  query(params?: QueryMessagesInput): Promise<UIChatMessage[]> {
    return this.messageModel.query(params);
  }

  async update(id: string, params: Partial<UpdateMessageParams>): Promise<void> {
    await this.messageModel.update(id, params);
  }

  async updatePluginState(id: string, state: Record<string, any>): Promise<void> {
    await this.messageModel.updatePluginState(id, state);
  }

  async updateToolMessage(id: string, params: UpdateToolMessageInput): Promise<void> {
    await this.messageModel.updateToolMessage(id, params);
  }
}
