import {
  ChatFileItem,
  ChatMessageError,
  ChatTTS,
  ChatTranslate,
  CreateMessageParams,
  CreateNewMessageParams,
  ModelRankItem,
  UIChatMessage,
} from '@lobechat/types';
import dayjs from 'dayjs';

import { FileModel } from '@/database/_deprecated/models/file';
import { MessageModel } from '@/database/_deprecated/models/message';
import { DB_Message } from '@/database/_deprecated/schemas/message';

import { IMessageService } from './type';

export class ClientService implements IMessageService {
  async createMessage(data: CreateMessageParams) {
    const { id } = await MessageModel.create(data);

    return id;
  }

  async createNewMessage(data: CreateNewMessageParams) {
    const { id } = await MessageModel.create(data as any);
    const messages = await this.getMessages(data.sessionId, data.topicId);

    return { id, messages };
  }

  // @ts-ignore
  async batchCreateMessages(messages: UIChatMessage[]) {
    return MessageModel.batchCreate(messages);
  }

  async getMessages(sessionId: string, topicId?: string): Promise<UIChatMessage[]> {
    const messages = await MessageModel.query({ sessionId, topicId });

    const fileList = (await Promise.all(
      messages
        .flatMap((item) => item.files)
        .filter(Boolean)
        .map(async (id) => FileModel.findById(id!)),
    )) as ChatFileItem[];

    return messages.map((item) => ({
      ...item,
      imageList: fileList
        .filter((file) => item.files?.includes(file.id) && file.fileType.startsWith('image'))
        .map((file) => ({
          alt: file.name,
          id: file.id,
          url: file.url,
        })),
    }));
  }

  async getGroupMessages(groupId: string, topicId?: string): Promise<UIChatMessage[]> {
    // For the deprecated service, group messages are the same as regular messages
    // since the old schema doesn't differentiate between session and group messages
    return this.getMessages(groupId, topicId);
  }

  async getAllMessages() {
    return MessageModel.queryAll();
  }

  async countMessages() {
    return MessageModel.count();
  }

  // @ts-ignore
  async rankModels(): Promise<ModelRankItem[]> {
    throw new Error('Method not implemented.');
  }

  // @ts-ignore
  async countWords(): Promise<number> {
    throw new Error('Method not implemented.');
  }

  // @ts-ignore
  async getHeatmaps() {
    throw new Error('Method not implemented.');
  }

  async countTodayMessages() {
    const topics = await MessageModel.queryAll();
    return topics.filter(
      (item) => dayjs(item.createdAt).format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD'),
    ).length;
  }

  async getAllMessagesInSession(sessionId: string) {
    return MessageModel.queryBySessionId(sessionId);
  }

  async updateMessageError(id: string, error: ChatMessageError) {
    return MessageModel.update(id, { error });
  }

  // @ts-ignore
  async updateMessage(id: string, message: Partial<DB_Message>) {
    return MessageModel.update(id, message);
  }

  async updateMessageTTS(id: string, tts: Partial<ChatTTS> | false) {
    return MessageModel.update(id, { tts });
  }

  async updateMessageTranslate(id: string, translate: Partial<ChatTranslate> | false) {
    return MessageModel.update(id, { translate });
  }

  async updateMessagePluginState(id: string, value: Record<string, any>) {
    return MessageModel.updatePluginState(id, value);
  }

  async updateMessagePluginArguments(id: string, value: string | Record<string, any>) {
    const args = typeof value === 'string' ? value : JSON.stringify(value);

    return MessageModel.updatePlugin(id, { arguments: args });
  }

  async bindMessagesToTopic(topicId: string, messageIds: string[]) {
    return MessageModel.batchUpdate(messageIds, { topicId });
  }

  async removeMessage(id: string) {
    return MessageModel.delete(id);
  }

  async removeMessages(ids: string[]) {
    return MessageModel.bulkDelete(ids);
  }

  async removeMessagesByAssistant(assistantId: string, topicId?: string) {
    return MessageModel.batchDelete(assistantId, topicId);
  }

  async removeMessagesByGroup(groupId: string, topicId?: string) {
    return MessageModel.batchDelete(groupId, topicId);
  }

  async removeAllMessages() {
    return MessageModel.clearTable();
  }

  async hasMessages() {
    const number = await this.countMessages();
    return number > 0;
  }

  async messageCountToCheckTrace() {
    const number = await this.countMessages();
    return number >= 4;
  }

  async updateMessagePluginError() {
    throw new Error('Method not implemented.');
  }

  async updateMessageRAG(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
