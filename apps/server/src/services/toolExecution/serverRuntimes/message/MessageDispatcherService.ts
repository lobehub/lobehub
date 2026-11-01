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
  MessageSendRoute,
  PinMessageParams,
  PinMessageState,
  ReactToMessageParams,
  ReactToMessageState,
  ReadDocumentParams,
  ReadDocumentState,
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

/** Drop the routing keys so platform services only ever see their own params. */
const stripRoute = <T extends MessageSendRoute>(params: T): Omit<T, keyof MessageSendRoute> => {
  const { botId: _botId, messengerInstallationId: _messengerInstallationId, ...rest } = params;
  return rest;
};

export type AsyncServiceFactory = () => Promise<MessageRuntimeService>;

/** Routing inputs every dispatched call carries: its platform, plus an optional explicit connection. */
export type MessageRouteParams = MessageSendRoute & { platform: string };

/**
 * Picks the connection for one call before the per-platform default applies:
 * an explicit `botId` / `messengerInstallationId`, or the connection the
 * current IM conversation arrived on. Returns undefined to defer to the
 * platform default.
 */
export type MessageRouteResolver = (
  params: MessageRouteParams,
) => Promise<MessageRuntimeService | undefined>;

/**
 * Routes MessageRuntimeService calls to the appropriate platform service.
 *
 * Each call first asks `resolveRoute` (when given) for a specific connection;
 * otherwise it falls back to the per-platform default service, lazily created
 * on first use for each platform. The routing keys (`botId`,
 * `messengerInstallationId`) are stripped before the call reaches the
 * platform service.
 */
export class MessageDispatcherService implements MessageRuntimeService {
  private services = new Map<string, MessageRuntimeService>();
  private serviceFactories: Record<string, AsyncServiceFactory>;
  private resolveRoute?: MessageRouteResolver;

  constructor(
    serviceFactories: Record<string, AsyncServiceFactory>,
    options: { resolveRoute?: MessageRouteResolver } = {},
  ) {
    this.serviceFactories = serviceFactories;
    this.resolveRoute = options.resolveRoute;
  }

  private async getService(params: MessageRouteParams): Promise<MessageRuntimeService> {
    const routed = await this.resolveRoute?.(params);
    if (routed) return routed;

    const { platform } = params;
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
    return (await this.getService(params)).sendMessage(stripRoute(params));
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    return (await this.getService(params)).readMessages(params);
  };

  // Optional on the service contract: forward only when the platform has it,
  // so the runtime's "not supported on <platform>" branch stays reachable.
  readDocument = async (params: ReadDocumentParams): Promise<ReadDocumentState> => {
    const service = await this.getService(params);
    if (!service.readDocument) {
      throw new Error(`readDocument is not supported on ${params.platform}`);
    }
    return service.readDocument(params);
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    return (await this.getService(params)).editMessage(params);
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    return (await this.getService(params)).deleteMessage(params);
  };

  searchMessages = async (params: SearchMessagesParams): Promise<SearchMessagesState> => {
    return (await this.getService(params)).searchMessages(params);
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    return (await this.getService(params)).reactToMessage(params);
  };

  getReactions = async (params: GetReactionsParams): Promise<GetReactionsState> => {
    return (await this.getService(params)).getReactions(params);
  };

  // ==================== Pin Management ====================

  pinMessage = async (params: PinMessageParams): Promise<PinMessageState> => {
    return (await this.getService(params)).pinMessage(params);
  };

  unpinMessage = async (params: UnpinMessageParams): Promise<UnpinMessageState> => {
    return (await this.getService(params)).unpinMessage(params);
  };

  listPins = async (params: ListPinsParams): Promise<ListPinsState> => {
    return (await this.getService(params)).listPins(params);
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    return (await this.getService(params)).getChannelInfo(params);
  };

  listChannels = async (params: ListChannelsParams): Promise<ListChannelsState> => {
    return (await this.getService(params)).listChannels(params);
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    return (await this.getService(params)).getMemberInfo(params);
  };

  // ==================== Thread Operations ====================

  createThread = async (params: CreateThreadParams): Promise<CreateThreadState> => {
    return (await this.getService(params)).createThread(params);
  };

  listThreads = async (params: ListThreadsParams): Promise<ListThreadsState> => {
    return (await this.getService(params)).listThreads(params);
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    return (await this.getService(params)).replyToThread(stripRoute(params));
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (params: CreatePollParams): Promise<CreatePollState> => {
    return (await this.getService(params)).createPoll(params);
  };
}
