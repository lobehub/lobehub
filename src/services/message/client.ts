import { UIChatMessage } from '@lobechat/types';

import { INBOX_SESSION_ID } from '@/const/session';
import { clientDB } from '@/database/client/db';
import { MessageModel } from '@/database/models/message';
import { BaseClientService } from '@/services/baseClientService';
import { clientS3Storage } from '@/services/file/ClientS3';

import { IMessageService } from './type';

export class ClientService extends BaseClientService implements IMessageService {
  private get messageModel(): MessageModel {
    return new MessageModel(clientDB as any, this.userId);
  }

  createMessage: IMessageService['createMessage'] = async ({ sessionId, ...params }) => {
    const { id } = await this.messageModel.create({
      ...params,
      sessionId: sessionId ? (this.toDbSessionId(sessionId) as string) : '',
    });

    return id;
  };

  createNewMessage: IMessageService['createNewMessage'] = async ({ sessionId, ...params }) => {
    return await this.messageModel.createNewMessage(
      {
        ...params,
        sessionId: sessionId ? (this.toDbSessionId(sessionId) as string) : '',
      },
      {
        postProcessUrl: this.postProcessUrl,
      },
    );
  };

  batchCreateMessages: IMessageService['batchCreateMessages'] = async (messages) => {
    return this.messageModel.batchCreate(messages);
  };

  getMessages: IMessageService['getMessages'] = async (sessionId, topicId) => {
    const data = await this.messageModel.query(
      {
        sessionId: this.toDbSessionId(sessionId),
        topicId,
      },
      {
        postProcessUrl: this.postProcessUrl,
      },
    );

    return data as unknown as UIChatMessage[];
  };

  getGroupMessages: IMessageService['getGroupMessages'] = async (groupId, topicId) => {
    // Use full query to hydrate fileList/imageList like single chat
    const data = await this.messageModel.query(
      {
        sessionId: groupId,
        topicId,
      },
      {
        postProcessUrl: this.postProcessUrl,
      },
    );

    return data as unknown as UIChatMessage[];
  };

  getAllMessages: IMessageService['getAllMessages'] = async () => {
    const data = await this.messageModel.queryAll();

    return data as unknown as UIChatMessage[];
  };

  countMessages: IMessageService['countMessages'] = async (params) => {
    return this.messageModel.count(params);
  };

  countWords: IMessageService['countWords'] = async (params) => {
    return this.messageModel.countWords(params);
  };

  rankModels: IMessageService['rankModels'] = async () => {
    return this.messageModel.rankModels();
  };

  getHeatmaps: IMessageService['getHeatmaps'] = async () => {
    return this.messageModel.getHeatmaps();
  };

  getAllMessagesInSession: IMessageService['getAllMessagesInSession'] = async (sessionId) => {
    const data = this.messageModel.queryBySessionId(this.toDbSessionId(sessionId));

    return data as unknown as UIChatMessage[];
  };

  updateMessageError: IMessageService['updateMessageError'] = async (id, error) => {
    return this.messageModel.update(id, { error });
  };

  updateMessage: IMessageService['updateMessage'] = async (id, message) => {
    return this.messageModel.update(id, message);
  };

  updateMessageTTS: IMessageService['updateMessageTTS'] = async (id, tts) => {
    return this.messageModel.updateTTS(id, tts as any);
  };

  updateMessageTranslate: IMessageService['updateMessageTranslate'] = async (id, translate) => {
    return this.messageModel.updateTranslate(id, translate as any);
  };

  updateMessagePluginState: IMessageService['updateMessagePluginState'] = async (id, value) => {
    return this.messageModel.updatePluginState(id, value);
  };

  updateMessagePluginError: IMessageService['updateMessagePluginError'] = async (id, value) => {
    return this.messageModel.updateMessagePlugin(id, { error: value });
  };

  updateMessageRAG: IMessageService['updateMessageRAG'] = async (id, value) => {
    console.log(id, value);
    throw new Error('not implemented');
  };

  updateMessagePluginArguments: IMessageService['updateMessagePluginArguments'] = async (
    id,
    value,
  ) => {
    const args = typeof value === 'string' ? value : JSON.stringify(value);

    return this.messageModel.updateMessagePlugin(id, { arguments: args });
  };

  removeMessage: IMessageService['removeMessage'] = async (id) => {
    return this.messageModel.deleteMessage(id);
  };

  removeMessages: IMessageService['removeMessages'] = async (ids) => {
    return this.messageModel.deleteMessages(ids);
  };

  removeMessagesByAssistant: IMessageService['removeMessagesByAssistant'] = async (
    sessionId,
    topicId,
  ) => {
    return this.messageModel.deleteMessagesBySession(this.toDbSessionId(sessionId), topicId);
  };

  removeMessagesByGroup: IMessageService['removeMessagesByGroup'] = async (groupId, topicId) => {
    return this.messageModel.deleteMessagesBySession(groupId, topicId);
  };

  removeAllMessages: IMessageService['removeAllMessages'] = async () => {
    return this.messageModel.deleteAllMessages();
  };

  hasMessages: IMessageService['hasMessages'] = async () => {
    const number = await this.countMessages();
    return number > 0;
  };

  messageCountToCheckTrace: IMessageService['messageCountToCheckTrace'] = async () => {
    const number = await this.countMessages();
    return number >= 4;
  };

  private toDbSessionId = (sessionId: string | undefined) => {
    return sessionId === INBOX_SESSION_ID ? undefined : sessionId;
  };

  private postProcessUrl = async (url: string | null, file: any) => {
    const hash = (url as string).replace('client-s3://', '');
    const base64 = await this.getBase64ByFileHash(hash);

    return `data:${file.fileType};base64,${base64}`;
  };

  private getBase64ByFileHash = async (hash: string) => {
    const fileItem = await clientS3Storage.getObject(hash);
    if (!fileItem) throw new Error('file not found');

    return Buffer.from(await fileItem.arrayBuffer()).toString('base64');
  };
}
