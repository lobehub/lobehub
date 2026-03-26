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
  MessageRuntimeService,
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

import type { MessagePlatformAdapter } from './adapters/types';

export type AsyncAdapterFactory = () => Promise<MessagePlatformAdapter>;

/**
 * Routes MessageRuntimeService calls to the appropriate platform adapter
 * based on the `platform` field in each method's params.
 *
 * Adapters are lazily created on first use for each platform.
 */
export class MessageDispatcherService implements MessageRuntimeService {
  private adapters = new Map<string, MessagePlatformAdapter>();
  private adapterFactories: Record<string, AsyncAdapterFactory>;

  constructor(adapterFactories: Record<string, AsyncAdapterFactory>) {
    this.adapterFactories = adapterFactories;
  }

  private async getAdapter(platform: string): Promise<MessagePlatformAdapter> {
    const cached = this.adapters.get(platform);
    if (cached) return cached;

    const factory = this.adapterFactories[platform];
    if (!factory) {
      const supported = Object.keys(this.adapterFactories).join(', ');
      throw new Error(
        `No message adapter configured for platform "${platform}". ` +
          `Supported platforms: ${supported}`,
      );
    }

    const adapter = await factory();
    this.adapters.set(platform, adapter);
    return adapter;
  }

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    return (await this.getAdapter(params.platform)).sendMessage(params);
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    return (await this.getAdapter(params.platform)).readMessages(params);
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    return (await this.getAdapter(params.platform)).editMessage(params);
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    return (await this.getAdapter(params.platform)).deleteMessage(params);
  };

  searchMessages = async (params: SearchMessagesParams): Promise<SearchMessagesState> => {
    return (await this.getAdapter(params.platform)).searchMessages(params);
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    return (await this.getAdapter(params.platform)).reactToMessage(params);
  };

  getReactions = async (params: GetReactionsParams): Promise<GetReactionsState> => {
    return (await this.getAdapter(params.platform)).getReactions(params);
  };

  // ==================== Pin Management ====================

  pinMessage = async (params: PinMessageParams): Promise<PinMessageState> => {
    return (await this.getAdapter(params.platform)).pinMessage(params);
  };

  unpinMessage = async (params: UnpinMessageParams): Promise<UnpinMessageState> => {
    return (await this.getAdapter(params.platform)).unpinMessage(params);
  };

  listPins = async (params: ListPinsParams): Promise<ListPinsState> => {
    return (await this.getAdapter(params.platform)).listPins(params);
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    return (await this.getAdapter(params.platform)).getChannelInfo(params);
  };

  listChannels = async (params: ListChannelsParams): Promise<ListChannelsState> => {
    return (await this.getAdapter(params.platform)).listChannels(params);
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    return (await this.getAdapter(params.platform)).getMemberInfo(params);
  };

  // ==================== Thread Operations ====================

  createThread = async (params: CreateThreadParams): Promise<CreateThreadState> => {
    return (await this.getAdapter(params.platform)).createThread(params);
  };

  listThreads = async (params: ListThreadsParams): Promise<ListThreadsState> => {
    return (await this.getAdapter(params.platform)).listThreads(params);
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    return (await this.getAdapter(params.platform)).replyToThread(params);
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (params: CreatePollParams): Promise<CreatePollState> => {
    return (await this.getAdapter(params.platform)).createPoll(params);
  };
}
