import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

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
} from '../types';

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
  sendMessage: (params: SendMessageParams) => Promise<SendMessageState>;
  unpinMessage: (params: UnpinMessageParams) => Promise<UnpinMessageState>;
}

export interface MessageExecutionRuntimeOptions {
  service: MessageRuntimeService;
}

export class MessageExecutionRuntime {
  private service: MessageRuntimeService;

  constructor(options: MessageExecutionRuntimeOptions) {
    this.service = options.service;
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

      return {
        content: `Fetched ${count} messages from ${params.platform}:${params.channelId}\n\n${formatted ?? '(no messages)'}`,
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
      const formatted = result.reactions
        ?.map((r) => `${r.emoji}: ${r.count}`)
        .join(', ');

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
      const formatted = result.channels
        ?.map((c) => `#${c.name} (${c.id})`)
        .join('\n');

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
      const formatted = result.threads
        ?.map((t) => `${t.name} (${t.id})`)
        .join('\n');

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
}
