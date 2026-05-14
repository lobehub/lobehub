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

import type { WhatsAppApi } from './api';

export class WhatsAppMessageService implements MessageRuntimeService {
  constructor(private api: WhatsAppApi) {}

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const result = await this.api.sendText(params.channelId, params.content);
    return {
      channelId: params.channelId,
      messageId: result.id,
      platform: 'whatsapp',
    };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'readMessages');
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'deleteMessage');
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'searchMessages');
  };

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'listPins');
  };

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'listChannels');
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'replyToThread');
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('WhatsApp', 'createPoll');
  };
}
