import type {
  CreatePollParams,
  CreatePollState,
  CreateThreadParams,
  CreateThreadState,
  DeleteMessageParams,
  DeleteMessageState,
  EditMessageParams,
  EditMessageState,
  GetChannelInfoParams,
  GetChannelInfoState,
  GetMemberInfoParams,
  GetMemberInfoState,
  GetReactionsParams,
  GetReactionsState,
  ListChannelsParams,
  ListChannelsState,
  ListPinsParams,
  ListPinsState,
  ListThreadsParams,
  ListThreadsState,
  PinMessageParams,
  PinMessageState,
  ReactToMessageParams,
  ReactToMessageState,
  ReadMessagesParams,
  ReadMessagesState,
  ReplyToThreadParams,
  ReplyToThreadState,
  SearchMessagesParams,
  SearchMessagesState,
  SendMessageParams,
  SendMessageState,
  UnpinMessageParams,
  UnpinMessageState,
} from '@lobechat/builtin-tool-message/executionRuntime';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import type { TelegramApi } from './api';

export class TelegramMessageService implements MessageRuntimeService {
  constructor(private api: TelegramApi) {}

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const result = await this.api.sendMessage(params.channelId, params.content);
    return {
      channelId: params.channelId,
      messageId: String(result.message_id),
      platform: 'telegram',
    };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError('Telegram', 'readMessages');
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    await this.api.editMessageText(params.channelId, Number(params.messageId), params.content);
    return { messageId: params.messageId, success: true };
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    await this.api.deleteMessage(params.channelId, Number(params.messageId));
    return { messageId: params.messageId, success: true };
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError('Telegram', 'searchMessages');
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    await this.api.setMessageReaction(params.channelId, Number(params.messageId), params.emoji);
    return { messageId: params.messageId, success: true };
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('Telegram', 'getReactions');
  };

  // ==================== Pin Management ====================

  pinMessage = async (params: PinMessageParams): Promise<PinMessageState> => {
    await this.api.pinChatMessage(params.channelId, Number(params.messageId));
    return { messageId: params.messageId, success: true };
  };

  unpinMessage = async (params: UnpinMessageParams): Promise<UnpinMessageState> => {
    await this.api.unpinChatMessage(params.channelId, Number(params.messageId));
    return { messageId: params.messageId, success: true };
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('Telegram', 'listPins');
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    const chat = await this.api.getChat(params.channelId);
    return {
      description: chat.description ?? undefined,
      id: String(chat.id),
      memberCount: chat.member_count ?? undefined,
      name: chat.title ?? chat.first_name ?? undefined,
      type: chat.type,
    };
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('Telegram', 'listChannels');
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    if (!params.serverId) {
      throw new Error('Telegram requires serverId (chat ID) to get member info');
    }
    const member = await this.api.getChatMember(params.serverId, Number(params.memberId));
    const user = member.user;
    return {
      displayName: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || undefined,
      id: String(user?.id ?? params.memberId),
      status: member.status,
      username: user?.username ?? undefined,
    };
  };

  // ==================== Thread Operations ====================

  createThread = async (params: CreateThreadParams): Promise<CreateThreadState> => {
    const result = await this.api.createForumTopic(params.channelId, params.name);
    if (params.content) {
      await this.api.sendMessageToTopic(params.channelId, result.message_thread_id, params.content);
    }
    // Return compound format "chatId:topicId" so replyToThread can parse it
    return { threadId: `${params.channelId}:${result.message_thread_id}` };
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('Telegram', 'listThreads');
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    const parts = params.threadId.split(':');
    let chatId: string;
    let topicId: number;
    if (parts.length >= 2) {
      chatId = parts[0];
      topicId = Number(parts[1]);
    } else {
      throw new Error('Telegram replyToThread requires threadId in "chatId:topicId" format');
    }

    const result = await this.api.sendMessageToTopic(chatId, topicId, params.content);
    return { messageId: String(result.message_id), threadId: params.threadId };
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (params: CreatePollParams): Promise<CreatePollState> => {
    const result = await this.api.sendPoll(
      params.channelId,
      params.question,
      params.options,
      undefined,
      params.multipleAnswers,
    );
    return {
      messageId: String(result.message_id),
      pollId: result.poll_id ?? String(result.message_id),
    };
  };
}
