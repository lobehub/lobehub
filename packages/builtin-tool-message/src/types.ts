// ==================== Identifier ====================

export const MessageToolIdentifier = 'lobe-message';

// ==================== Supported Platforms ====================

export const MessagePlatform = {
  discord: 'discord',
  googlechat: 'googlechat',
  irc: 'irc',
  slack: 'slack',
  telegram: 'telegram',
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

// --- Core Message Operations ---

export interface SendMessageParams {
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
  /** Max number of messages to fetch (default: 50, max: 100) */
  limit?: number;
  /** Platform to read from */
  platform: MessagePlatformType;
}

export interface ReadMessagesState {
  channelId?: string;
  messages?: MessageItem[];
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
