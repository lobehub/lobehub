// ==================== Identifier ====================

export const MessageToolIdentifier = 'lobe-message';

// ==================== Supported Platforms ====================

export const MessagePlatform = {
  discord: 'discord',
  feishu: 'feishu',
  imessage: 'imessage',
  lark: 'lark',
  qq: 'qq',
  slack: 'slack',
  telegram: 'telegram',
  wechat: 'wechat',
} as const;

export type MessagePlatformType = (typeof MessagePlatform)[keyof typeof MessagePlatform];

// ==================== API Names ====================

export const MessageApiName = {
  // Core message operations (cross-platform)
  deleteMessage: 'deleteMessage',
  editMessage: 'editMessage',
  getReactions: 'getReactions',
  listPins: 'listPins',
  pinMessage: 'pinMessage',
  reactToMessage: 'reactToMessage',
  readMessages: 'readMessages',
  searchMessages: 'searchMessages',
  sendMessage: 'sendMessage',
  unpinMessage: 'unpinMessage',

  // Channel management
  getChannelInfo: 'getChannelInfo',
  listChannels: 'listChannels',

  // Member information
  getMemberInfo: 'getMemberInfo',

  // Thread operations
  createThread: 'createThread',
  listThreads: 'listThreads',
  replyToThread: 'replyToThread',

  // Platform-specific
  createPoll: 'createPoll',

  // Direct messaging
  sendDirectMessage: 'sendDirectMessage',

  // Bot management
  connectBot: 'connectBot',
  createBot: 'createBot',
  deleteBot: 'deleteBot',
  getBotDetail: 'getBotDetail',
  listBots: 'listBots',
  listPlatforms: 'listPlatforms',
  toggleBot: 'toggleBot',
  updateBot: 'updateBot',

  // ==================== System Bot Messenger Management ====================
  // Operates on `messenger_installations` (workspace-scoped OAuth installs)
  // and `messenger_account_links` (per-user routing decisions). Mirrors the
  // per-agent bot CRUD surface but for the LobeHub System Bot, which can't
  // be created via tool calls (OAuth requires browser flow).
  /** List the current user's System Bot installations across workspaces. */
  listMessengers: 'listMessengers',
  /** Get one System Bot connection's detail by installationId. */
  getMessengerDetail: 'getMessengerDetail',
  /** Revoke a workspace install (cascades to all users in that workspace). */
  uninstallMessenger: 'uninstallMessenger',
  /** List the platforms where the user can install the LobeHub System Bot. */
  listMessengerPlatforms: 'listMessengerPlatforms',
  /** List the user's account links — one row per (platform, tenant). */
  listMessengerLinks: 'listMessengerLinks',
  /** Change which agent receives inbound IM on a specific link. */
  setMessengerActiveAgent: 'setMessengerActiveAgent',
  /** Remove the user's account link for a platform (does not uninstall). */
  unlinkMessenger: 'unlinkMessenger',
} as const;

export type MessageApiNameType = (typeof MessageApiName)[keyof typeof MessageApiName];

// ==================== Common Types ====================

export interface MessageTarget {
  /** Channel / conversation / room ID within the platform */
  channelId: string;
  /** Platform identifier */
  platform: MessagePlatformType;
}

// ==================== Parameter Types ====================

// --- Direct Messaging ---

export interface SendDirectMessageParams {
  /**
   * Optional: outbound media attachments (images / files / video / audio).
   * Same shape as `SendMessageParams.attachments` — see `SendMessageAttachment`.
   */
  attachments?: SendMessageAttachment[];
  /** Message content */
  content: string;
  /** Platform */
  platform: MessagePlatformType;
  /** Target user ID on the platform */
  userId: string;
}

export interface SendDirectMessageState {
  channelId?: string;
  messageId?: string;
  platform?: string;
}

// --- Core Message Operations ---

/**
 * JSON-safe outbound attachment for `sendMessage`. Either `data` (base64) or
 * `fetchUrl` (remote URL) must be set. Prefer `fetchUrl` to keep payload size
 * small when the binary already lives somewhere reachable.
 *
 * Mirrors `BotMessageAttachment` on the bot-reply callback path so the agent
 * runtime, callback service, and Messager tool/CLI all speak the same shape.
 */
export interface SendMessageAttachment {
  /** Base64-encoded bytes. Used when no fetchable URL exists. */
  data?: string;
  /** Remote URL the platform server can GET to retrieve the bytes. */
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  type: 'image' | 'file' | 'video' | 'audio';
}

export interface SendMessageParams {
  /**
   * Optional: outbound media attachments (images / files / video / audio).
   * Platforms that don't support outbound media silently drop these so the
   * text leg still ships.
   */
  attachments?: SendMessageAttachment[];
  /** Channel / conversation / room ID */
  channelId: string;
  /** Message content (text, markdown depending on platform support) */
  content: string;
  /** Optional: embed / attachment metadata (platform-specific) */
  embeds?: Record<string, unknown>[];
  /** Platform to send on */
  platform: MessagePlatformType;
  /** Optional: reply to a specific message */
  replyTo?: string;
}

export interface SendMessageState {
  channelId?: string;
  messageId?: string;
  platform?: string;
}

export interface ReadMessagesParams {
  /** Optional: read messages after this message ID */
  after?: string;
  /** Optional: read messages before this message ID */
  before?: string;
  /** Channel / conversation / room ID */
  channelId: string;
  /** Pagination cursor from a previous response (Feishu/Lark pageToken) */
  cursor?: string;
  /** End time as Unix second timestamp (Feishu/Lark only) */
  endTime?: string;
  /** Max number of messages to fetch */
  limit?: number;
  /** Platform to read from */
  platform: MessagePlatformType;
  /** Start time as Unix second timestamp (Feishu/Lark only) */
  startTime?: string;
}

export interface ReadMessagesState {
  channelId?: string;
  /** Whether more messages are available */
  hasMore?: boolean;
  messages?: MessageItem[];
  /** Cursor for fetching the next page */
  nextCursor?: string;
  platform?: string;
  totalFetched?: number;
}

export interface MessageItem {
  attachments?: { name: string; url: string }[];
  author: { id: string; name: string };
  content: string;
  id: string;
  replyTo?: string;
  timestamp: string;
}

export interface EditMessageParams {
  /** Channel ID where the message is */
  channelId: string;
  /** New content */
  content: string;
  /** Message ID to edit */
  messageId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface EditMessageState {
  messageId?: string;
  success?: boolean;
}

export interface DeleteMessageParams {
  /** Channel ID where the message is */
  channelId: string;
  /** Message ID to delete */
  messageId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface DeleteMessageState {
  messageId?: string;
  success?: boolean;
}

export interface SearchMessagesParams {
  /** Optional: filter by author */
  authorId?: string;
  /** Channel ID to search in */
  channelId: string;
  /** Max results (default: 25) */
  limit?: number;
  /** Platform */
  platform: MessagePlatformType;
  /** Search query */
  query: string;
}

export interface SearchMessagesState {
  messages?: MessageItem[];
  query?: string;
  totalFound?: number;
}

export interface ReactToMessageParams {
  /** Channel ID */
  channelId: string;
  /** Emoji to react with (unicode emoji or platform-specific format) */
  emoji: string;
  /** Message ID to react to */
  messageId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface ReactToMessageState {
  messageId?: string;
  success?: boolean;
}

export interface GetReactionsParams {
  /** Channel ID */
  channelId: string;
  /** Message ID */
  messageId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface GetReactionsState {
  messageId?: string;
  reactions?: { count: number; emoji: string; users?: string[] }[];
}

export interface PinMessageParams {
  /** Channel ID */
  channelId: string;
  /** Message ID to pin */
  messageId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface PinMessageState {
  messageId?: string;
  success?: boolean;
}

export interface UnpinMessageParams {
  /** Channel ID */
  channelId: string;
  /** Message ID to unpin */
  messageId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface UnpinMessageState {
  messageId?: string;
  success?: boolean;
}

export interface ListPinsParams {
  /** Channel ID */
  channelId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface ListPinsState {
  messages?: MessageItem[];
}

// --- Channel Management ---

export interface GetChannelInfoParams {
  /** Channel ID */
  channelId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface GetChannelInfoState {
  description?: string;
  id?: string;
  memberCount?: number;
  name?: string;
  type?: string;
}

export interface ListChannelsParams {
  /** Optional: filter by category or type */
  filter?: string;
  /** Platform */
  platform: MessagePlatformType;
  /** Server / workspace / group ID (required for platforms with multi-server) */
  serverId?: string;
}

export interface ListChannelsState {
  channels?: { id: string; name: string; type?: string }[];
}

// --- Member Information ---

export interface GetMemberInfoParams {
  /** Member / user ID */
  memberId: string;
  /** Platform */
  platform: MessagePlatformType;
  /** Server / workspace ID (required for some platforms) */
  serverId?: string;
}

export interface GetMemberInfoState {
  avatar?: string;
  displayName?: string;
  id?: string;
  roles?: string[];
  status?: string;
  username?: string;
}

// --- Thread Operations ---

export interface CreateThreadParams {
  /** Channel ID to create thread in */
  channelId: string;
  /** Optional: initial message content */
  content?: string;
  /** Optional: message ID to start thread from */
  messageId?: string;
  /** Thread name */
  name: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface CreateThreadState {
  threadId?: string;
}

export interface ListThreadsParams {
  /** Channel ID */
  channelId: string;
  /** Platform */
  platform: MessagePlatformType;
}

export interface ListThreadsState {
  threads?: { id: string; messageCount?: number; name: string }[];
}

export interface ReplyToThreadParams {
  /**
   * Optional: outbound media attachments (images / files / video / audio).
   * Same shape as `SendMessageParams.attachments` — see `SendMessageAttachment`.
   */
  attachments?: SendMessageAttachment[];
  /** Reply content */
  content: string;
  /** Platform */
  platform: MessagePlatformType;
  /** Thread ID */
  threadId: string;
}

export interface ReplyToThreadState {
  messageId?: string;
  threadId?: string;
}

// --- Platform-Specific: Polls ---

export interface CreatePollParams {
  /** Channel ID */
  channelId: string;
  /** Duration in hours (platform-specific limits) */
  duration?: number;
  /** Allow multiple answers */
  multipleAnswers?: boolean;
  /** Poll options */
  options: string[];
  /** Platform */
  platform: MessagePlatformType;
  /** Poll question */
  question: string;
}

export interface CreatePollState {
  messageId?: string;
  pollId?: string;
}

// --- Bot Management ---

export interface ListPlatformsParams {
  /** No parameters needed */
}

export interface PlatformInfo {
  credentialFields: { key: string; label: string; required: boolean; type: string }[];
  id: string;
  name: string;
}

export interface ListPlatformsState {
  platforms: PlatformInfo[];
}

export interface ListBotsParams {
  /** No parameters needed — returns all bots for the current agent */
}

export interface ConfiguredBotInfo {
  applicationId: string;
  enabled: boolean;
  id: string;
  platform: string;
  runtimeStatus?: string;
  /** Default server/guild/workspace ID (for listing channels) */
  serverId?: string;
  /** Owner's user ID on the platform (for sending DMs) */
  userId?: string;
}

export interface ListBotsState {
  bots: ConfiguredBotInfo[];
}

export interface GetBotDetailParams {
  botId: string;
}

export interface GetBotDetailState {
  applicationId: string;
  enabled: boolean;
  id: string;
  platform: string;
  runtimeStatus?: string;
  settings?: Record<string, unknown>;
}

export interface CreateBotParams {
  /** Agent ID to attach the bot to */
  agentId: string;
  /** Application ID for webhook routing */
  applicationId: string;
  /** Credential key-value pairs (platform-specific) */
  credentials: Record<string, string>;
  /** Target platform */
  platform: string;
  /**
   * Optional initial settings (DM policy, allowlist, server/user IDs, etc.).
   * Same shape as `UpdateBotParams.settings`. Omit to use schema defaults.
   */
  settings?: Record<string, unknown>;
}

export interface CreateBotState {
  id: string;
  platform: string;
}

export interface UpdateBotParams {
  botId: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown>;
}

export interface UpdateBotState {
  success: boolean;
}

export interface DeleteBotParams {
  botId: string;
}

export interface DeleteBotState {
  success: boolean;
}

export interface ToggleBotParams {
  botId: string;
  enabled: boolean;
}

export interface ToggleBotState {
  enabled: boolean;
  success: boolean;
}

export interface ConnectBotParams {
  botId: string;
}

export interface ConnectBotState {
  status: string;
}

// --- System Bot Messenger Management ---

/**
 * Summary of a System Bot installation surfaced to the LLM / caller. Mirrors
 * the safe metadata shape returned by `messenger.listMyInstallations` — never
 * the credentials.
 */
export interface MessengerInfo {
  /** Platform application/bot id (Slack appId, Discord applicationId, …). */
  applicationId: string;
  /** Slack-only: enterprise grid id when this is an enterprise install. */
  enterpriseId?: string | null;
  /** Stable installation id — pass back on `uninstallMessenger` / `getMessengerDetail`. */
  id: string;
  /** ISO timestamp of when the install was created (or Date instance). */
  installedAt?: string | Date;
  /** Slack-only: whether this install is at the enterprise (org-wide) level. */
  isEnterpriseInstall?: boolean;
  /** Messaging platform (slack / discord / telegram / …). */
  platform: string;
  /** OAuth scope string granted at install time (Slack-only typically). */
  scope?: string;
  /** Tenant identifier — Slack workspace, Discord guild, WeChat user, … (empty for Telegram). */
  tenantId: string;
  /** Optional human-friendly tenant label (workspace / guild name). */
  tenantName?: string;
}

/**
 * Summary of a user-platform account link. One row per (userId, platform,
 * tenantId) — controls which agent the user's inbound IM messages route to.
 */
export interface MessengerLinkInfo {
  /** The agent currently set as active for inbound messages (null = unset). */
  activeAgentId: string | null;
  /** When the link was created. */
  createdAt?: string | Date;
  platform: string;
  /** Platform-side user id (Slack/Discord user id, Telegram chat id, WeChat user id). */
  platformUserId?: string;
  /** Display name surfaced when verify-im completed. */
  platformUsername?: string;
  /** Tenant scope for the link — empty for single-link platforms (Telegram / WeChat). */
  tenantId?: string;
}

/**
 * Subset of `messenger.availablePlatforms` payload surfaced to the LLM.
 * Includes the deep-link fields the verify-im flow uses to direct the user
 * to the right install URL.
 */
export interface MessengerPlatformInfo {
  /** Slack appId or Discord applicationId — feeds deep-link URLs. */
  appId?: string;
  /** Telegram-only deep-link target (`https://t.me/<botUsername>`). */
  botUsername?: string;
  /** Platform id (slack / discord / telegram / …). */
  id: string;
  /** Display name. */
  name: string;
}

export interface ListMessengersParams {
  /** No parameters needed — returns all installs for the current user. */
}

export interface ListMessengersState {
  installations: MessengerInfo[];
}

export interface GetMessengerDetailParams {
  /** Stable installation id from `listMessengers`. */
  installationId: string;
}

export interface GetMessengerDetailState extends MessengerInfo {
  /** ISO timestamp of when the install was revoked (null when active). */
  revokedAt?: string | Date | null;
}

export interface UninstallMessengerParams {
  installationId: string;
}

export interface UninstallMessengerState {
  success: boolean;
}

export interface ListMessengerPlatformsParams {
  /** No parameters needed. */
}

export interface ListMessengerPlatformsState {
  platforms: MessengerPlatformInfo[];
}

export interface ListMessengerLinksParams {
  /** No parameters needed — returns all links for the current user. */
}

export interface ListMessengerLinksState {
  links: MessengerLinkInfo[];
}

export interface SetMessengerActiveAgentParams {
  /**
   * Agent id to route inbound messages to. Pass `null` to clear the active
   * agent (next message hits the "/agents to pick" prompt).
   */
  agentId: string | null;
  platform: string;
  /** Optional: scope to a specific workspace (Slack). Omit for global-bot platforms. */
  tenantId?: string;
}

export interface SetMessengerActiveAgentState {
  success: boolean;
}

export interface UnlinkMessengerParams {
  platform: string;
  /** Optional: scope to a specific workspace (Slack). Omit for global-bot platforms. */
  tenantId?: string;
}

export interface UnlinkMessengerState {
  success: boolean;
}
