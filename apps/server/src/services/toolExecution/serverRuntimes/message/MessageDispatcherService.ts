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

export type AsyncServiceFactory = () => Promise<MessageRuntimeService>;

/**
 * Routes MessageRuntimeService calls to the appropriate platform service
 * based on the `platform` field in each method's params.
 *
 * Services are lazily created on first use for each platform.
 */
export class MessageDispatcherService implements MessageRuntimeService {
  private services = new Map<string, MessageRuntimeService>();
  private serviceFactories: Record<string, AsyncServiceFactory>;

  constructor(serviceFactories: Record<string, AsyncServiceFactory>) {
    this.serviceFactories = serviceFactories;
  }

  private async getService(platform: string): Promise<MessageRuntimeService> {
    const cached = this.services.get(platform);
    if (cached) return cached;

    const factory = this.serviceFactories[platform];
    if (!factory) {
      const supported = Object.keys(this.serviceFactories).join(', ');
      throw new Error(
        `No message service configured for platform "${platform}". ` +
          `Supported platforms: ${supported}`,
      );
    }

    const service = await factory();
    this.services.set(platform, service);
    return service;
  }

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    return (await this.getService(params.platform)).sendMessage(params);
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    return (await this.getService(params.platform)).readMessages(params);
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    return (await this.getService(params.platform)).editMessage(params);
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    return (await this.getService(params.platform)).deleteMessage(params);
  };

  searchMessages = async (params: SearchMessagesParams): Promise<SearchMessagesState> => {
    return (await this.getService(params.platform)).searchMessages(params);
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    return (await this.getService(params.platform)).reactToMessage(params);
  };

  getReactions = async (params: GetReactionsParams): Promise<GetReactionsState> => {
    return (await this.getService(params.platform)).getReactions(params);
  };

  // ==================== Pin Management ====================

  pinMessage = async (params: PinMessageParams): Promise<PinMessageState> => {
    return (await this.getService(params.platform)).pinMessage(params);
  };

  unpinMessage = async (params: UnpinMessageParams): Promise<UnpinMessageState> => {
    return (await this.getService(params.platform)).unpinMessage(params);
  };

  listPins = async (params: ListPinsParams): Promise<ListPinsState> => {
    return (await this.getService(params.platform)).listPins(params);
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    return (await this.getService(params.platform)).getChannelInfo(params);
  };

  listChannels = async (params: ListChannelsParams): Promise<ListChannelsState> => {
    return (await this.getService(params.platform)).listChannels(params);
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    return (await this.getService(params.platform)).getMemberInfo(params);
  };

  // ==================== Thread Operations ====================

  createThread = async (params: CreateThreadParams): Promise<CreateThreadState> => {
    return (await this.getService(params.platform)).createThread(params);
  };

  listThreads = async (params: ListThreadsParams): Promise<ListThreadsState> => {
    return (await this.getService(params.platform)).listThreads(params);
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    return (await this.getService(params.platform)).replyToThread(params);
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (params: CreatePollParams): Promise<CreatePollState> => {
    return (await this.getService(params.platform)).createPoll(params);
  };
}
