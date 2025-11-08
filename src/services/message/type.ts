import {
  ChatMessageError,
  ChatMessagePluginError,
  ChatTTS,
  ChatTranslate,
  CreateMessageParams,
  CreateMessageResult,
  DBMessageItem,
  ModelRankItem,
  UIChatMessage,
  UpdateMessageParams,
  UpdateMessageRAGParams,
} from '@lobechat/types';
import type { HeatmapsProps } from '@lobehub/charts';

/* eslint-disable typescript-sort-keys/interface */

export interface IMessageService {
  createMessage(data: CreateMessageParams): Promise<string>;
  createNewMessage(data: CreateMessageParams): Promise<CreateMessageResult>;
  batchCreateMessages(messages: DBMessageItem[]): Promise<any>;

  getMessages(sessionId: string, topicId?: string, groupId?: string): Promise<UIChatMessage[]>;
  getGroupMessages(groupId: string, topicId?: string): Promise<UIChatMessage[]>;
  getAllMessages(): Promise<UIChatMessage[]>;
  getAllMessagesInSession(sessionId: string): Promise<UIChatMessage[]>;
  countMessages(params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number>;
  countWords(params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number>;
  rankModels(): Promise<ModelRankItem[]>;
  getHeatmaps(): Promise<HeatmapsProps['data']>;
  updateMessageError(id: string, error: ChatMessageError): Promise<any>;
  updateMessage(id: string, message: Partial<UpdateMessageParams>): Promise<any>;
  updateMessageTTS(id: string, tts: Partial<ChatTTS> | false): Promise<any>;
  updateMessageTranslate(id: string, translate: Partial<ChatTranslate> | false): Promise<any>;
  updateMessagePluginState(id: string, value: Record<string, any>): Promise<any>;
  updateMessagePluginError(id: string, value: ChatMessagePluginError | null): Promise<any>;
  updateMessageRAG(id: string, value: UpdateMessageRAGParams): Promise<void>;
  updateMessagePluginArguments(id: string, value: string | Record<string, any>): Promise<any>;
  removeMessage(id: string): Promise<any>;
  removeMessages(ids: string[]): Promise<any>;
  removeMessagesByAssistant(assistantId: string, topicId?: string): Promise<any>;
  removeMessagesByGroup(groupId: string, topicId?: string): Promise<any>;
  removeAllMessages(): Promise<any>;
  messageCountToCheckTrace(): Promise<boolean>;
  hasMessages(): Promise<boolean>;
}
