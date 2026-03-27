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
import type { WechatApiClient } from '@lobechat/chat-adapter-wechat';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

/**
 * WeChat iLink Bot message adapter.
 *
 * WeChat iLink protocol requires a per-conversation `context_token` for sending messages.
 * The gateway long-polling client persists these tokens to Redis as they arrive from
 * inbound messages. This adapter reads them from Redis to enable `sendMessage`.
 *
 * channelId for WeChat = target user ID (e.g., "o9cq800kum_4g8Py8Qw5G0a@im.wechat")
 */
export class WechatMessageService implements MessageRuntimeService {
  private applicationId: string;

  constructor(
    private api: WechatApiClient,
    applicationId: string,
  ) {
    this.applicationId = applicationId;
  }

  /**
   * Resolve the context token for a target user from Redis.
   * The gateway client stores it at `wechat:ctx-token:${applicationId}:${userId}`.
   */
  private async resolveContextToken(userId: string): Promise<string> {
    // Best-effort: try Redis first, fall back to empty string.
    // Testing shows sendMessage works even without a context_token in some sessions,
    // but providing one ensures reliable message delivery to the correct conversation.
    try {
      const redis = getAgentRuntimeRedisClient();
      if (redis) {
        const key = `wechat:ctx-token:${this.applicationId}:${userId}`;
        const token = await redis.get(key);
        if (token) return token;
      }
    } catch {
      // Redis unavailable — fall through
    }
    return '';
  }

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const contextToken = await this.resolveContextToken(params.channelId);
    await this.api.sendMessage(params.channelId, params.content, contextToken);
    return {
      channelId: params.channelId,
      platform: 'wechat',
    };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError('WeChat', 'readMessages');
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'deleteMessage');
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError('WeChat', 'searchMessages');
  };

  // ==================== Reactions ====================

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('WeChat', 'getReactions');
  };

  // ==================== Pin Management ====================

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('WeChat', 'listPins');
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError('WeChat', 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('WeChat', 'listChannels');
  };

  // ==================== Member Information ====================

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('WeChat', 'getMemberInfo');
  };

  // ==================== Thread Operations ====================

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('WeChat', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('WeChat', 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError('WeChat', 'replyToThread');
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('WeChat', 'createPoll');
  };
}
