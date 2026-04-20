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
  MessageItem,
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
import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { DEFAULT_BOT_HISTORY_LIMIT } from '@lobechat/const';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import { MAX_FEISHU_HISTORY_LIMIT } from './const';

/**
 * Normalize a Feishu/Lark message object to MessageItem.
 */
const toMessageItem = (msg: any): MessageItem => {
  let content: string;
  try {
    const parsed = JSON.parse(msg.body?.content ?? '{}');
    content = parsed.text ?? '';
  } catch {
    content = msg.body?.content ?? '';
  }

  return {
    author: {
      id: msg.sender?.id ?? '',
      name: msg.sender?.sender_type === 'user' ? (msg.sender?.id ?? 'User') : 'Bot',
    },
    content,
    id: msg.message_id ?? '',
    replyTo: msg.parent_id ?? msg.root_id ?? undefined,
    timestamp: msg.create_time
      ? new Date(Number(msg.create_time)).toISOString()
      : new Date().toISOString(),
  };
};

export class FeishuMessageService implements MessageRuntimeService {
  private platformName: string;

  constructor(
    private api: LarkApiClient,
    platformName: 'feishu' | 'lark' = 'feishu',
  ) {
    this.platformName = platformName;
  }

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const result = await this.api.sendMessage(params.channelId, params.content);
    return {
      channelId: params.channelId,
      messageId: result.messageId,
      platform: this.platformName,
    };
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    const result = await this.api.listMessages(params.channelId, {
      endTime: params.endTime,
      pageSize: Math.min(params.limit ?? DEFAULT_BOT_HISTORY_LIMIT, MAX_FEISHU_HISTORY_LIMIT),
      pageToken: params.cursor,
      startTime: params.startTime,
    });
    const messages = result.items.map(toMessageItem);
    return {
      channelId: params.channelId,
      hasMore: result.hasMore,
      messages,
      nextCursor: result.pageToken,
      platform: this.platformName,
      totalFetched: messages.length,
    };
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    await this.api.editMessage(params.messageId, params.content);
    return { messageId: params.messageId, success: true };
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    await this.api.deleteMessage(params.messageId);
    return { messageId: params.messageId, success: true };
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError(this.platformName, 'searchMessages');
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    await this.api.addReaction(params.messageId, params.emoji);
    return { messageId: params.messageId, success: true };
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'getReactions');
  };

  // ==================== Pin Management ====================

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError(this.platformName, 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError(this.platformName, 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'listPins');
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    const chat = await this.api.getChatInfo(params.channelId);
    return {
      description: chat.description ?? undefined,
      id: params.channelId,
      memberCount: chat.user_count ?? undefined,
      name: chat.name ?? undefined,
      type: chat.chat_mode ?? 'group',
    };
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'listChannels');
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    const user = await this.api.getUserInfo(params.memberId);
    return {
      displayName: user?.name ?? undefined,
      id: params.memberId,
      username: user?.name ?? undefined,
    };
  };

  // ==================== Thread Operations ====================

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError(this.platformName, 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'listThreads');
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    const result = await this.api.replyMessage(params.threadId, params.content);
    return { messageId: result.messageId, threadId: params.threadId };
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError(this.platformName, 'createPoll');
  };
}
