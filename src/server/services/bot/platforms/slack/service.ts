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
  MessageItem,
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
import { DEFAULT_BOT_HISTORY_LIMIT } from '@lobechat/const';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import type { SlackApi } from './api';
import { MAX_SLACK_HISTORY_LIMIT } from './const';

/**
 * Normalize a Slack message object to MessageItem.
 */
const toMessageItem = (msg: any): MessageItem => ({
  attachments: msg.files?.map((f: any) => ({ name: f.name ?? f.title, url: f.url_private })),
  author: { id: msg.user ?? '', name: msg.username ?? msg.user ?? 'Unknown' },
  content: msg.text ?? '',
  id: msg.ts ?? '',
  replyTo: msg.thread_ts !== msg.ts ? msg.thread_ts : undefined,
  timestamp: msg.ts ? new Date(Number(msg.ts) * 1000).toISOString() : new Date().toISOString(),
});

export class SlackMessageService implements MessageRuntimeService {
  constructor(private api: SlackApi) {}

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const result = await this.api.postMessage(params.channelId, params.content);
    return { channelId: params.channelId, messageId: result.ts, platform: 'slack' };
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    const result = await this.api.getHistory(params.channelId, {
      latest: params.before,
      limit: Math.min(params.limit ?? DEFAULT_BOT_HISTORY_LIMIT, MAX_SLACK_HISTORY_LIMIT),
      oldest: params.after,
    });
    const messages = result.messages.map(toMessageItem);
    return {
      channelId: params.channelId,
      messages,
      platform: 'slack',
      totalFetched: messages.length,
    };
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    await this.api.updateMessage(params.channelId, params.messageId, params.content);
    return { messageId: params.messageId, success: true };
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    await this.api.deleteMessage(params.channelId, params.messageId);
    return { messageId: params.messageId, success: true };
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    // Slack search.messages requires a user token (xoxp-), not a bot token (xoxb-).
    // Bot tokens do not have the search:read scope.
    throw new PlatformUnsupportedError(
      'Slack',
      'searchMessages (requires user token, not bot token)',
    );
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    const name = params.emoji.replaceAll(':', '');
    await this.api.addReaction(params.channelId, params.messageId, name);
    return { messageId: params.messageId, success: true };
  };

  getReactions = async (params: GetReactionsParams): Promise<GetReactionsState> => {
    const result = await this.api.getReactions(params.channelId, params.messageId);
    return {
      messageId: params.messageId,
      reactions: result.reactions.map((r: any) => ({
        count: r.count,
        emoji: r.name,
        users: r.users,
      })),
    };
  };

  // ==================== Pin Management ====================

  pinMessage = async (params: PinMessageParams): Promise<PinMessageState> => {
    await this.api.pinMessage(params.channelId, params.messageId);
    return { messageId: params.messageId, success: true };
  };

  unpinMessage = async (params: UnpinMessageParams): Promise<UnpinMessageState> => {
    await this.api.unpinMessage(params.channelId, params.messageId);
    return { messageId: params.messageId, success: true };
  };

  listPins = async (params: ListPinsParams): Promise<ListPinsState> => {
    const result = await this.api.listPins(params.channelId);
    return {
      messages: result.items.map((item: any) => toMessageItem(item.message ?? item)),
    };
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    const channel = await this.api.getChannelInfo(params.channelId);
    return {
      description: channel.purpose?.value ?? channel.topic?.value ?? undefined,
      id: channel.id,
      memberCount: channel.num_members ?? undefined,
      name: channel.name ?? undefined,
      type: channel.is_private ? 'private' : 'public',
    };
  };

  listChannels = async (params: ListChannelsParams): Promise<ListChannelsState> => {
    const result = await this.api.listChannels();
    let channels = result.channels;
    if (params.filter) {
      channels = channels.filter((c: any) => c.name?.includes(params.filter));
    }
    return {
      channels: channels.map((c: any) => ({
        id: c.id,
        name: c.name ?? '',
        type: c.is_private ? 'private' : 'public',
      })),
    };
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    const user = await this.api.getUserInfo(params.memberId);
    return {
      avatar: user.profile?.image_72 ?? undefined,
      displayName: user.profile?.display_name || user.real_name || undefined,
      id: user.id,
      status: user.deleted ? 'deactivated' : user.is_bot ? 'bot' : 'active',
      username: user.name ?? undefined,
    };
  };

  // ==================== Thread Operations ====================

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('Slack', 'createThread');
  };

  listThreads = async (params: ListThreadsParams): Promise<ListThreadsState> => {
    const result = await this.api.getHistory(params.channelId, { limit: 100 });
    const threads = result.messages
      .filter((m: any) => m.reply_count && m.reply_count > 0)
      .map((m: any) => ({
        id: `${params.channelId}:${m.ts}`,
        messageCount: m.reply_count,
        name: (m.text ?? '').slice(0, 80) || '(thread)',
      }));

    return { threads };
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    const parts = params.threadId.split(':');
    let channelId: string;
    let threadTs: string;
    if (parts.length >= 2) {
      channelId = parts[0];
      threadTs = parts[1];
    } else {
      throw new Error('Slack replyToThread requires threadId in "channelId:threadTs" format');
    }

    const result = await this.api.postMessageInThread(channelId, threadTs, params.content);
    return { messageId: result.ts, threadId: params.threadId };
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('Slack', 'createPoll');
  };
}
