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

import type { DiscordApi } from './api';
import { MAX_DISCORD_HISTORY_LIMIT } from './const';

/**
 * Normalize a Discord API message object to MessageItem.
 */
const toMessageItem = (msg: any): MessageItem => ({
  attachments: msg.attachments?.map((a: any) => ({ name: a.filename, url: a.url })),
  author: { id: msg.author?.id ?? '', name: msg.author?.username ?? 'Unknown' },
  content: msg.content ?? '',
  id: msg.id,
  replyTo: msg.message_reference?.message_id,
  timestamp: msg.timestamp ?? new Date().toISOString(),
});

export class DiscordMessageService implements MessageRuntimeService {
  constructor(private api: DiscordApi) {}

  // ==================== Direct Messaging ====================

  sendDirectMessage = async (params: {
    content: string;
    userId: string;
  }): Promise<{ channelId?: string; messageId?: string; platform?: string }> => {
    const dmChannel = await this.api.createDMChannel(params.userId);
    const result = await this.api.createMessage(dmChannel.id, params.content);
    return { channelId: dmChannel.id, messageId: result.id, platform: 'discord' };
  };

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const result = await this.api.createMessage(params.channelId, params.content);
    return { channelId: params.channelId, messageId: result.id, platform: 'discord' };
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    const messages = await this.api.getMessages(params.channelId, {
      after: params.after || undefined,
      before: params.before || undefined,
      limit: Math.min(params.limit ?? DEFAULT_BOT_HISTORY_LIMIT, MAX_DISCORD_HISTORY_LIMIT),
    });
    const items = messages.map(toMessageItem);
    return {
      channelId: params.channelId,
      messages: items,
      platform: 'discord',
      totalFetched: items.length,
    };
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    await this.api.editMessage(params.channelId, params.messageId, params.content);
    return { messageId: params.messageId, success: true };
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    await this.api.deleteMessage(params.channelId, params.messageId);
    return { messageId: params.messageId, success: true };
  };

  searchMessages = async (params: SearchMessagesParams): Promise<SearchMessagesState> => {
    const channel = await this.api.getChannel(params.channelId);
    const guildId = (channel as any).guild_id;
    if (!guildId) {
      throw new Error('Search is only available in guild channels (not DMs)');
    }

    const query: Record<string, string> = {
      channel_id: params.channelId,
      content: params.query,
    };
    if (params.authorId) query.author_id = params.authorId;
    if (params.limit) query.limit = String(Math.min(params.limit, 25));

    const result = await this.api.searchGuildMessages(guildId, query);
    const messages = result.messages
      ?.flat()
      .filter((m: any) => m.hit)
      .map(toMessageItem);

    return { messages, query: params.query, totalFound: result.total_results };
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    await this.api.createReaction(params.channelId, params.messageId, params.emoji);
    return { messageId: params.messageId, success: true };
  };

  getReactions = async (params: GetReactionsParams): Promise<GetReactionsState> => {
    // Fetch the specific message to get its reaction metadata
    const msg = await this.api.getMessage(params.channelId, params.messageId);

    if (!(msg as any).reactions) {
      return { messageId: params.messageId, reactions: [] };
    }

    const reactions = await Promise.all(
      ((msg as any).reactions as any[]).map(async (r: any) => {
        const emoji = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name;
        const users = await this.api.getReactions(params.channelId, params.messageId, emoji);
        return {
          count: r.count,
          emoji,
          users: users.map((u: any) => u.username ?? u.id),
        };
      }),
    );

    return { messageId: params.messageId, reactions };
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
    const pinned = await this.api.getPinnedMessages(params.channelId);
    return { messages: pinned.map(toMessageItem) };
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    const channel = await this.api.getChannel(params.channelId);
    return {
      description: (channel as any).topic ?? undefined,
      id: channel.id,
      memberCount: (channel as any).member_count,
      name: (channel as any).name ?? undefined,
      type: String((channel as any).type),
    };
  };

  listChannels = async (params: ListChannelsParams): Promise<ListChannelsState> => {
    if (!params.serverId) {
      throw new Error('Discord requires serverId (guild ID) to list channels');
    }
    const channels = await this.api.getGuildChannels(params.serverId);
    const filtered = params.filter
      ? channels.filter((c: any) => c.name?.includes(params.filter))
      : channels;
    return {
      channels: filtered.map((c: any) => ({
        id: c.id,
        name: c.name ?? '',
        type: String(c.type),
      })),
    };
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    if (!params.serverId) {
      throw new Error('Discord requires serverId (guild ID) to get member info');
    }
    const member = await this.api.getGuildMember(params.serverId, params.memberId);
    return {
      avatar: member.avatar ?? (member.user as any)?.avatar ?? undefined,
      displayName: member.nick ?? (member.user as any)?.global_name ?? undefined,
      id: (member.user as any)?.id ?? params.memberId,
      roles: member.roles,
      status: undefined,
      username: (member.user as any)?.username ?? undefined,
    };
  };

  // ==================== Thread Operations ====================

  createThread = async (params: CreateThreadParams): Promise<CreateThreadState> => {
    let thread: any;
    if (params.messageId) {
      thread = await this.api.startThreadFromMessage(
        params.channelId,
        params.messageId,
        params.name,
      );
    } else {
      thread = await this.api.startThreadWithoutMessage(
        params.channelId,
        params.name,
        params.content,
      );
    }
    return { threadId: thread.id };
  };

  listThreads = async (params: ListThreadsParams): Promise<ListThreadsState> => {
    const channel = await this.api.getChannel(params.channelId);
    const guildId = (channel as any).guild_id;
    if (!guildId) {
      throw new Error('Thread listing is only available in guild channels');
    }

    const result = await this.api.listActiveThreads(guildId);
    const threads = result.threads
      .filter((t: any) => t.parent_id === params.channelId)
      .map((t: any) => ({
        id: t.id,
        messageCount: t.message_count,
        name: t.name ?? '',
      }));

    return { threads };
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    const result = await this.api.createMessage(params.threadId, params.content);
    return { messageId: result.id, threadId: params.threadId };
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (params: CreatePollParams): Promise<CreatePollState> => {
    const result = await this.api.createPoll(
      params.channelId,
      params.question,
      params.options,
      params.duration,
      params.multipleAnswers,
    );
    return { messageId: result.id, pollId: result.id };
  };
}
