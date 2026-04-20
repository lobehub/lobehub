import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ConfiguredBotInfo,
  ConnectBotParams,
  ConnectBotState,
  CreateBotParams,
  CreateBotState,
  CreatePollParams,
  CreatePollState,
  CreateThreadParams,
  CreateThreadState,
  DeleteBotParams,
  DeleteBotState,
  DeleteMessageParams,
  DeleteMessageState,
  EditMessageParams,
  EditMessageState,
  GetBotDetailParams,
  GetBotDetailState,
  GetChannelInfoParams,
  GetChannelInfoState,
  GetMemberInfoParams,
  GetMemberInfoState,
  GetReactionsParams,
  GetReactionsState,
  ListBotsParams,
  ListBotsState,
  ListChannelsParams,
  ListChannelsState,
  ListPinsParams,
  ListPinsState,
  ListPlatformsParams,
  ListPlatformsState,
  ListThreadsParams,
  ListThreadsState,
  PinMessageParams,
  PinMessageState,
  PlatformInfo,
  ReactToMessageParams,
  ReactToMessageState,
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
  ToggleBotParams,
  ToggleBotState,
  UnpinMessageParams,
  UnpinMessageState,
  UpdateBotParams,
  UpdateBotState,
} from '../types';

// Re-export all param/state types so adapters can import from executionRuntime entry
export type {
  ConfiguredBotInfo,
  ConnectBotParams,
  ConnectBotState,
  CreateBotParams,
  CreateBotState,
  CreatePollParams,
  CreatePollState,
  CreateThreadParams,
  CreateThreadState,
  DeleteBotParams,
  DeleteBotState,
  DeleteMessageParams,
  DeleteMessageState,
  EditMessageParams,
  EditMessageState,
  GetBotDetailParams,
  GetBotDetailState,
  GetChannelInfoParams,
  GetChannelInfoState,
  GetMemberInfoParams,
  GetMemberInfoState,
  GetReactionsParams,
  GetReactionsState,
  ListBotsParams,
  ListBotsState,
  ListChannelsParams,
  ListChannelsState,
  ListPinsParams,
  ListPinsState,
  ListPlatformsParams,
  ListPlatformsState,
  ListThreadsParams,
  ListThreadsState,
  PinMessageParams,
  PinMessageState,
  PlatformInfo,
  ReactToMessageParams,
  ReactToMessageState,
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
  ToggleBotParams,
  ToggleBotState,
  UnpinMessageParams,
  UnpinMessageState,
  UpdateBotParams,
  UpdateBotState,
} from '../types';
export type { MessageItem } from '../types';

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
  }) => Promise<{ id: string; platform: string }>;
  deleteBot: (botId: string) => Promise<void>;
  getBotDetail: (botId: string) => Promise<GetBotDetailState | null>;
  listBots: () => Promise<ConfiguredBotInfo[]>;
  listPlatforms: () => Promise<PlatformInfo[]>;
  toggleBot: (botId: string, enabled: boolean) => Promise<void>;
  updateBot: (
    botId: string,
    params: { credentials?: Record<string, string>; settings?: Record<string, unknown> },
  ) => Promise<void>;
}

export interface MessageExecutionRuntimeOptions {
  botProvider?: BotProviderQuery;
  service: MessageRuntimeService;
}

export class MessageExecutionRuntime {
  private botProvider?: BotProviderQuery;
  private service: MessageRuntimeService;

  constructor(options: MessageExecutionRuntimeOptions) {
    this.service = options.service;
    this.botProvider = options.botProvider;
  }

  // ==================== Core Message Operations ====================

  async sendMessage(params: SendMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.sendMessage(params);
      return {
        content: `Message sent to ${params.platform}:${params.channelId} (messageId: ${result.messageId})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `sendMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async readMessages(params: ReadMessagesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.readMessages(params);
      const count = result.messages?.length ?? 0;
      const formatted = result.messages
        ?.map((m) => `[${m.timestamp}] ${m.author.name}: ${m.content}`)
        .join('\n');

      const paginationHint =
        result.hasMore && result.nextCursor
          ? `\n\n[More messages available — pass cursor: "${result.nextCursor}" to fetch next page]`
          : '';

      return {
        content: `Fetched ${count} messages from ${params.platform}:${params.channelId}\n\n${formatted ?? '(no messages)'}${paginationHint}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `readMessages error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async editMessage(params: EditMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.editMessage(params);
      return {
        content: `Message ${params.messageId} edited successfully`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `editMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async deleteMessage(params: DeleteMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.deleteMessage(params);
      return {
        content: `Message ${params.messageId} deleted successfully`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `deleteMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async searchMessages(params: SearchMessagesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchMessages(params);
      const count = result.totalFound ?? result.messages?.length ?? 0;
      const formatted = result.messages
        ?.map((m) => `[${m.timestamp}] ${m.author.name}: ${m.content}`)
        .join('\n');

      return {
        content: `Found ${count} messages matching "${params.query}" in ${params.platform}:${params.channelId}\n\n${formatted ?? '(no results)'}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `searchMessages error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Reactions ====================

  async reactToMessage(params: ReactToMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.reactToMessage(params);
      return {
        content: `Reacted with ${params.emoji} to message ${params.messageId}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `reactToMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async getReactions(params: GetReactionsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.getReactions(params);
      const formatted = result.reactions?.map((r) => `${r.emoji}: ${r.count}`).join(', ');

      return {
        content: `Reactions on message ${params.messageId}: ${formatted ?? '(none)'}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `getReactions error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Pin Management ====================

  async pinMessage(params: PinMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.pinMessage(params);
      return {
        content: `Message ${params.messageId} pinned in ${params.platform}:${params.channelId}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `pinMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async unpinMessage(params: UnpinMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.unpinMessage(params);
      return {
        content: `Message ${params.messageId} unpinned`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `unpinMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async listPins(params: ListPinsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.listPins(params);
      const count = result.messages?.length ?? 0;

      return {
        content: `${count} pinned messages in ${params.platform}:${params.channelId}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `listPins error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Channel Management ====================

  async getChannelInfo(params: GetChannelInfoParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.getChannelInfo(params);
      return {
        content: `Channel: ${result.name ?? params.channelId} (type: ${result.type ?? 'unknown'}, members: ${result.memberCount ?? 'N/A'})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `getChannelInfo error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async listChannels(params: ListChannelsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.listChannels(params);
      const count = result.channels?.length ?? 0;
      const formatted = result.channels?.map((c) => `#${c.name} (${c.id})`).join('\n');

      return {
        content: `${count} channels found on ${params.platform}\n\n${formatted ?? '(none)'}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `listChannels error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Member Information ====================

  async getMemberInfo(params: GetMemberInfoParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.getMemberInfo(params);
      return {
        content: `Member: ${result.displayName ?? result.username ?? params.memberId} (status: ${result.status ?? 'unknown'})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `getMemberInfo error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Thread Operations ====================

  async createThread(params: CreateThreadParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.createThread(params);
      return {
        content: `Thread "${params.name}" created (threadId: ${result.threadId})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `createThread error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async listThreads(params: ListThreadsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.listThreads(params);
      const count = result.threads?.length ?? 0;
      const formatted = result.threads?.map((t) => `${t.name} (${t.id})`).join('\n');

      return {
        content: `${count} threads in ${params.platform}:${params.channelId}\n\n${formatted ?? '(none)'}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `listThreads error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async replyToThread(params: ReplyToThreadParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.replyToThread(params);
      return {
        content: `Reply sent to thread ${params.threadId} (messageId: ${result.messageId})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `replyToThread error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Platform-Specific: Polls ====================

  async createPoll(params: CreatePollParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.createPoll(params);
      return {
        content: `Poll "${params.question}" created in ${params.platform}:${params.channelId} (pollId: ${result.pollId})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `createPoll error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Direct Messaging ====================

  async sendDirectMessage(params: SendDirectMessageParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.sendDirectMessage) {
      return {
        content: `sendDirectMessage is not supported on ${params.platform}`,
        success: false,
      };
    }
    try {
      const result = await this.service.sendDirectMessage(params);
      return {
        content: `Direct message sent to user ${params.userId} on ${params.platform} (messageId: ${result.messageId})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `sendDirectMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Bot Management ====================

  async listPlatforms(_params: ListPlatformsParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const platforms = await this.botProvider.listPlatforms();
      const formatted = platforms
        .map((p) => {
          const reqFields = p.credentialFields
            .filter((f) => f.required)
            .map((f) => f.key)
            .join(', ');
          return `- **${p.name}** (${p.id})${reqFields ? ` — requires: ${reqFields}` : ''}`;
        })
        .join('\n');

      return {
        content: `${platforms.length} supported platform(s):\n${formatted}`,
        state: { platforms } satisfies ListPlatformsState,
        success: true,
      };
    } catch (e) {
      return { content: `listPlatforms error: ${(e as Error).message}`, success: false };
    }
  }

  async listBots(_params: ListBotsParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return {
        content: 'Bot provider query is not available in this context.',
        success: false,
      };
    }

    try {
      const bots = await this.botProvider.listBots();
      const formatted = bots
        .map((b) => {
          const parts = [
            `platform: ${b.platform}`,
            `botId: ${b.id}`,
            `enabled: ${b.enabled}`,
            `status: ${b.runtimeStatus ?? 'unknown'}`,
          ];
          if (b.serverId) {
            parts.push(`serverId: ${b.serverId}`);
          }
          if (b.userId) {
            parts.push(`userId: ${b.userId}`);
          }
          return `- ${b.platform} (${parts.join(', ')})`;
        })
        .join('\n');

      return {
        content:
          bots.length > 0
            ? `${bots.length} configured bot(s):\n${formatted}`
            : 'No bots configured for this agent. Set up a bot integration first.',
        state: { bots } satisfies ListBotsState,
        success: true,
      };
    } catch (e) {
      return {
        content: `listBots error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async getBotDetail(params: GetBotDetailParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const bot = await this.botProvider.getBotDetail(params.botId);
      if (!bot) {
        return { content: `Bot not found: ${params.botId}`, success: false };
      }
      return {
        content: `Bot ${bot.id}:\n- Platform: ${bot.platform}\n- App ID: ${bot.applicationId}\n- Enabled: ${bot.enabled}\n- Status: ${bot.runtimeStatus ?? 'unknown'}`,
        state: bot satisfies GetBotDetailState,
        success: true,
      };
    } catch (e) {
      return { content: `getBotDetail error: ${(e as Error).message}`, success: false };
    }
  }

  async createBot(params: CreateBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const result = await this.botProvider.createBot(params);
      return {
        content: `Created ${result.platform} bot (id: ${result.id})`,
        state: result satisfies CreateBotState,
        success: true,
      };
    } catch (e) {
      return { content: `createBot error: ${(e as Error).message}`, success: false };
    }
  }

  async updateBot(params: UpdateBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      await this.botProvider.updateBot(params.botId, {
        credentials: params.credentials,
        settings: params.settings,
      });
      return {
        content: `Updated bot ${params.botId}`,
        state: { success: true } satisfies UpdateBotState,
        success: true,
      };
    } catch (e) {
      return { content: `updateBot error: ${(e as Error).message}`, success: false };
    }
  }

  async deleteBot(params: DeleteBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      await this.botProvider.deleteBot(params.botId);
      return {
        content: `Deleted bot ${params.botId}`,
        state: { success: true } satisfies DeleteBotState,
        success: true,
      };
    } catch (e) {
      return { content: `deleteBot error: ${(e as Error).message}`, success: false };
    }
  }

  async toggleBot(params: ToggleBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      await this.botProvider.toggleBot(params.botId, params.enabled);
      return {
        content: `Bot ${params.botId} ${params.enabled ? 'enabled' : 'disabled'}`,
        state: { enabled: params.enabled, success: true } satisfies ToggleBotState,
        success: true,
      };
    } catch (e) {
      return { content: `toggleBot error: ${(e as Error).message}`, success: false };
    }
  }

  async connectBot(params: ConnectBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const result = await this.botProvider.connectBot(params.botId);
      return {
        content: `Bot connection initiated (status: ${result.status})`,
        state: result satisfies ConnectBotState,
        success: true,
      };
    } catch (e) {
      return { content: `connectBot error: ${(e as Error).message}`, success: false };
    }
  }
}
