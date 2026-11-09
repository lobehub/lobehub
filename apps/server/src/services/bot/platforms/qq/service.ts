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
import type { QQApiClient } from '@lobechat/chat-adapter-qq';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

const QQ_THREAD_TYPES = new Set(['c2c', 'dms', 'group', 'guild']);

/**
 * Parse channelId into thread type and target ID.
 * QQ channelId format: "type:id" (e.g., "group:123", "guild:456", "c2c:789", "dms:abc"); the
 * full platform thread id ("qq:c2c:789") is accepted too. A bare id carries no type, so it is
 * sent as a group message — `typeInferred` lets the caller explain a failure caused by that.
 */
export const parseChannelId = (
  channelId: string,
): { targetId: string; threadType: string; typeInferred: boolean } => {
  const parts = channelId.split(':');
  if (parts[0] === 'qq') parts.shift();
  if (parts.length >= 2 && QQ_THREAD_TYPES.has(parts[0])) {
    // guild thread ids carry a trailing guild id ("guild:<channelId>:<guildId>") — the send
    // endpoint only takes the channel id.
    const targetId = parts[0] === 'guild' ? parts[1] : parts.slice(1).join(':');
    return { targetId, threadType: parts[0], typeInferred: false };
  }
  return { targetId: channelId, threadType: 'group', typeInferred: true };
};

const sendQQMessage = async (
  api: QQApiClient,
  threadType: string,
  targetId: string,
  content: string,
): Promise<string | undefined> => {
  let result;
  switch (threadType) {
    case 'guild': {
      result = await api.sendGuildMessage(targetId, content);
      break;
    }
    case 'c2c': {
      result = await api.sendC2CMessage(targetId, content);
      break;
    }
    case 'dms': {
      result = await api.sendDmsMessage(targetId, content);
      break;
    }
    default: {
      result = await api.sendGroupMessage(targetId, content);
      break;
    }
  }
  return result?.id;
};

export class QQMessageService implements MessageRuntimeService {
  constructor(private api: QQApiClient) {}

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    // Note: QQ group/C2C messages (v2 API) require msg_id for passive replies.
    // Active messages have been disabled since April 2025.
    // Guild channel messages (v1 API) may still support active sending.
    // We attempt the send and let the QQ API return specific errors if unsupported.
    const { threadType, targetId, typeInferred } = parseChannelId(params.channelId);
    let messageId: string | undefined;
    try {
      messageId = await sendQQMessage(this.api, threadType, targetId, params.content);
    } catch (error) {
      if (!typeInferred) throw error;
      // QQ answers a group send to a c2c openid with "用户/群已注销" (11255), which reads as
      // "the group was dissolved". Say what actually went wrong instead.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `QQ channelId "${params.channelId}" has no conversation-type prefix, so it was sent as a ` +
          `group message and QQ rejected it. The conversation type may not match: use ` +
          `"c2c:${targetId}" for a direct chat or "group:${targetId}" for a group. QQ error: ${reason}`,
        { cause: error },
      );
    }
    return {
      channelId: params.channelId,
      messageId: messageId ?? undefined,
      platform: 'qq',
    };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError('QQ', 'readMessages');
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError('QQ', 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError('QQ', 'deleteMessage');
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError('QQ', 'searchMessages');
  };

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('QQ', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('QQ', 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('QQ', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('QQ', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('QQ', 'listPins');
  };

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError('QQ', 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('QQ', 'listChannels');
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('QQ', 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('QQ', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('QQ', 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError('QQ', 'replyToThread');
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('QQ', 'createPoll');
  };
}
