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

import type { MessagePlatformAdapter } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

/**
 * WeChat iLink Bot adapter.
 *
 * WeChat's iLink API requires a per-conversation context token obtained from
 * inbound messages. Most operations are unavailable outside of an active
 * conversation context managed by the gateway long-polling client.
 */
export class WechatMessageAdapter implements MessagePlatformAdapter {
  sendMessage = async (_params: SendMessageParams): Promise<SendMessageState> => {
    throw new PlatformUnsupportedError(
      'WeChat',
      'sendMessage (requires context token from active conversation)',
    );
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

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('WeChat', 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('WeChat', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('WeChat', 'listPins');
  };

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError('WeChat', 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('WeChat', 'listChannels');
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('WeChat', 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('WeChat', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('WeChat', 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError('WeChat', 'replyToThread');
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('WeChat', 'createPoll');
  };
}
