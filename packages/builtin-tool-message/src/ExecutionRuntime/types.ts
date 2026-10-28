import type {
  ConfiguredBotInfo,
  CreatePollParams,
  CreatePollState,
  CreateThreadParams,
  CreateThreadState,
  DeleteMessageParams,
  DeleteMessageState,
  EditMessageParams,
  EditMessageState,
  GetBotDetailState,
  GetChannelInfoParams,
  GetChannelInfoState,
  GetMemberInfoParams,
  GetMemberInfoState,
  GetMessengerDetailState,
  GetReactionsParams,
  GetReactionsState,
  ListChannelsParams,
  ListChannelsState,
  ListPinsParams,
  ListPinsState,
  ListThreadsParams,
  ListThreadsState,
  MessengerInfo,
  MessengerLinkInfo,
  MessengerPlatformInfo,
  MessengerPushStatus,
  PinMessageParams,
  PinMessageState,
  PlatformInfo,
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
  SendDirectMessageParams,
  SendDirectMessageState,
  SendMessageParams,
  SendMessageState,
  SendMessengerPushParams,
  SetMessengerActiveAgentParams,
  UnlinkMessengerParams,
  UnpinMessageParams,
  UnpinMessageState,
} from '../types';
import type { MessageImageResolver } from './messageImages';

/**
 * Service interface for message operations.
 * Each platform adapter must implement this interface for its supported operations.
 * Unsupported operations should throw an error indicating the platform limitation.
 */
export interface MessageRuntimeService {
  createPoll: (params: CreatePollParams) => Promise<CreatePollState>;
  createThread: (params: CreateThreadParams) => Promise<CreateThreadState>;
  deleteMessage: (params: DeleteMessageParams) => Promise<DeleteMessageState>;
  editMessage: (params: EditMessageParams) => Promise<EditMessageState>;
  getChannelInfo: (params: GetChannelInfoParams) => Promise<GetChannelInfoState>;
  getMemberInfo: (params: GetMemberInfoParams) => Promise<GetMemberInfoState>;
  getReactions: (params: GetReactionsParams) => Promise<GetReactionsState>;
  listChannels: (params: ListChannelsParams) => Promise<ListChannelsState>;
  listPins: (params: ListPinsParams) => Promise<ListPinsState>;
  listThreads: (params: ListThreadsParams) => Promise<ListThreadsState>;
  pinMessage: (params: PinMessageParams) => Promise<PinMessageState>;
  reactToMessage: (params: ReactToMessageParams) => Promise<ReactToMessageState>;
  /**
   * Read a cloud document linked from the chat. Optional: only platforms
   * with a document API (Feishu/Lark docx) implement it; the runtime reports
   * "not supported" elsewhere and `messageCapabilities` trims the tool.
   */
  readDocument?: (params: ReadDocumentParams) => Promise<ReadDocumentState>;
  readMessages: (params: ReadMessagesParams) => Promise<ReadMessagesState>;
  replyToThread: (params: ReplyToThreadParams) => Promise<ReplyToThreadState>;
  searchMessages: (params: SearchMessagesParams) => Promise<SearchMessagesState>;
  sendDirectMessage?: (params: SendDirectMessageParams) => Promise<SendDirectMessageState>;
  sendMessage: (params: SendMessageParams) => Promise<SendMessageState>;
  unpinMessage: (params: UnpinMessageParams) => Promise<UnpinMessageState>;
}

/**
 * Interface for bot provider management operations.
 * Implemented by the server-side factory using AgentBotProviderModel + TRPC router logic.
 */
export interface BotProviderQuery {
  connectBot: (botId: string) => Promise<{ status: string }>;
  createBot: (params: {
    agentId: string;
    applicationId: string;
    credentials: Record<string, string>;
    platform: string;
    settings?: Record<string, unknown>;
  }) => Promise<{ id: string; platform: string }>;
  deleteBot: (botId: string) => Promise<void>;
  getBotDetail: (botId: string) => Promise<GetBotDetailState | null>;
  // ─── System Bot messenger management ─────────────────────────────────
  // All optional so callers can compose a minimal BotProviderQuery. When
  // absent, the executor returns a "feature not wired up" message.
  /** Single install detail, or null when not found. */
  getMessengerDetail?: (installationId: string) => Promise<GetMessengerDetailState | null>;
  listBots: () => Promise<ConfiguredBotInfo[]>;
  /** User's account links across platforms. */
  listMessengerLinks?: () => Promise<MessengerLinkInfo[]>;
  /** Platforms available for OAuth install. */
  listMessengerPlatforms?: () => Promise<MessengerPlatformInfo[]>;
  /** User's workspace-scoped System Bot installs. */
  listMessengers?: () => Promise<MessengerInfo[]>;
  listPlatforms: () => Promise<PlatformInfo[]>;
  /**
   * Proactively push a message to the caller's own linked messenger DM.
   * Mirrors `messenger.sendMessengerPush` — the runtime resolves Slack
   * workspace ambiguity BEFORE calling this, so the handler only sees
   * deliverable requests.
   */
  sendMessengerPush?: (params: SendMessengerPushParams) => Promise<{
    remaining?: number;
    status: Exclude<MessengerPushStatus, 'needs_workspace_selection'>;
  }>;
  /** Change which agent receives inbound IM on a link. */
  setMessengerActiveAgent?: (params: SetMessengerActiveAgentParams) => Promise<void>;
  toggleBot: (botId: string, enabled: boolean) => Promise<void>;
  /** Revoke a workspace install (affects every user in that workspace). */
  uninstallMessenger?: (installationId: string) => Promise<void>;
  /** Remove the current user's account link only. */
  unlinkMessenger?: (params: UnlinkMessengerParams) => Promise<void>;
  updateBot: (
    botId: string,
    params: { credentials?: Record<string, string>; settings?: Record<string, unknown> },
  ) => Promise<void>;
}

export interface MessageExecutionRuntimeOptions {
  botProvider?: BotProviderQuery;
  /**
   * Stores image attachments of read / searched messages so they can ride on the tool result
   * (`state.images`) for vision models. Absent = images are named in the text only.
   */
  resolveImages?: MessageImageResolver;
  service: MessageRuntimeService;
}
