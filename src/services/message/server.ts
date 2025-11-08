/* eslint-disable @typescript-eslint/no-unused-vars */
import { ChatTranslate, UIChatMessage } from '@lobechat/types';

import { INBOX_SESSION_ID } from '@/const/session';
import { lambdaClient } from '@/libs/trpc/client';

import { IMessageService } from './type';

export class ServerService implements IMessageService {
  createMessage: IMessageService['createMessage'] = async ({ sessionId, ...params }) => {
    return lambdaClient.message.createMessage.mutate({
      ...params,
      sessionId: sessionId ? this.toDbSessionId(sessionId) : undefined,
    });
  };

  createNewMessage: IMessageService['createNewMessage'] = async ({ sessionId, ...params }) => {
    return lambdaClient.message.createNewMessage.mutate({
      ...params,
      sessionId: sessionId ? this.toDbSessionId(sessionId) : undefined,
    });
  };

  batchCreateMessages: IMessageService['batchCreateMessages'] = async (messages) => {
    return lambdaClient.message.batchCreateMessages.mutate(messages);
  };

  getMessages: IMessageService['getMessages'] = async (sessionId, topicId, groupId) => {
    const data = await lambdaClient.message.getMessages.query({
      groupId,
      sessionId: this.toDbSessionId(sessionId),
      topicId,
    });

    return data as unknown as UIChatMessage[];
  };

  getGroupMessages: IMessageService['getGroupMessages'] = async (groupId, topicId) => {
    const data = await lambdaClient.message.getMessages.query({
      groupId,
      topicId,
    });
    return data as unknown as UIChatMessage[];
  };

  getAllMessages: IMessageService['getAllMessages'] = async () => {
    return lambdaClient.message.getAllMessages.query();
  };

  getAllMessagesInSession: IMessageService['getAllMessagesInSession'] = async (sessionId) => {
    return lambdaClient.message.getAllMessagesInSession.query({
      sessionId: this.toDbSessionId(sessionId),
    });
  };

  countMessages: IMessageService['countMessages'] = async (params) => {
    return lambdaClient.message.count.query(params);
  };

  countWords: IMessageService['countWords'] = async (params) => {
    return lambdaClient.message.countWords.query(params);
  };

  rankModels: IMessageService['rankModels'] = async () => {
    return lambdaClient.message.rankModels.query();
  };

  getHeatmaps: IMessageService['getHeatmaps'] = async () => {
    return lambdaClient.message.getHeatmaps.query();
  };

  updateMessageError: IMessageService['updateMessageError'] = async (id, error) => {
    return lambdaClient.message.update.mutate({ id, value: { error } });
  };

  updateMessagePluginArguments: IMessageService['updateMessagePluginArguments'] = async (
    id,
    value,
  ) => {
    const args = typeof value === 'string' ? value : JSON.stringify(value);
    return lambdaClient.message.updateMessagePlugin.mutate({ id, value: { arguments: args } });
  };

  updateMessage: IMessageService['updateMessage'] = async (id, value) => {
    return lambdaClient.message.update.mutate({ id, value });
  };

  updateMessageTranslate: IMessageService['updateMessageTranslate'] = async (id, translate) => {
    return lambdaClient.message.updateTranslate.mutate({ id, value: translate as ChatTranslate });
  };

  updateMessageTTS: IMessageService['updateMessageTTS'] = async (id, tts) => {
    return lambdaClient.message.updateTTS.mutate({ id, value: tts });
  };

  updateMessagePluginState: IMessageService['updateMessagePluginState'] = async (id, value) => {
    return lambdaClient.message.updatePluginState.mutate({ id, value });
  };

  updateMessagePluginError: IMessageService['updateMessagePluginError'] = async (id, error) => {
    return lambdaClient.message.updatePluginError.mutate({ id, value: error as any });
  };

  updateMessageRAG: IMessageService['updateMessageRAG'] = async (id, data) => {
    return lambdaClient.message.updateMessageRAG.mutate({ id, value: data });
  };

  removeMessage: IMessageService['removeMessage'] = async (id) => {
    return lambdaClient.message.removeMessage.mutate({ id });
  };

  removeMessages: IMessageService['removeMessages'] = async (ids) => {
    return lambdaClient.message.removeMessages.mutate({ ids });
  };

  removeMessagesByAssistant: IMessageService['removeMessagesByAssistant'] = async (
    sessionId,
    topicId,
  ) => {
    return lambdaClient.message.removeMessagesByAssistant.mutate({
      sessionId: this.toDbSessionId(sessionId),
      topicId,
    });
  };

  removeMessagesByGroup: IMessageService['removeMessagesByGroup'] = async (groupId, topicId) => {
    return lambdaClient.message.removeMessagesByGroup.mutate({
      groupId,
      topicId,
    });
  };

  removeAllMessages: IMessageService['removeAllMessages'] = async () => {
    return lambdaClient.message.removeAllMessages.mutate();
  };

  private toDbSessionId = (sessionId: string | undefined) => {
    return sessionId === INBOX_SESSION_ID ? null : sessionId;
  };

  hasMessages: IMessageService['hasMessages'] = async () => {
    const number = await this.countMessages();
    return number > 0;
  };

  messageCountToCheckTrace: IMessageService['messageCountToCheckTrace'] = async () => {
    const number = await this.countMessages();
    return number >= 4;
  };
}
