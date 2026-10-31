import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CreatePollParams,
  CreateThreadParams,
  DeleteMessageParams,
  EditMessageParams,
  GetChannelInfoParams,
  GetMemberInfoParams,
  GetReactionsParams,
  ListChannelsParams,
  ListPinsParams,
  ListThreadsParams,
  MessageItem,
  PinMessageParams,
  ReactToMessageParams,
  ReadDocumentParams,
  ReadMessagesParams,
  ReplyToThreadParams,
  SearchMessagesParams,
  SendDirectMessageParams,
  SendMessageParams,
  UnpinMessageParams,
} from '../types';
import { describeAttachmentOutcome } from './attachmentOutcome';
import type { MessageImageResolver } from './messageImages';
import {
  collectImageCandidates,
  describeAttachedImages,
  formatMessageLines,
} from './messageImages';
import { describeDiscordPagination } from './pagination';
import type { MessageExecutionRuntimeOptions, MessageRuntimeService } from './types';

/**
 * Operations on a chat platform's channels, messages and threads, all served by the platform
 * adapter (`MessageRuntimeService`). Bot and messenger management builds on this in
 * `MessageExecutionRuntime`.
 */
export class ChannelMessageRuntime {
  private resolveImages?: MessageImageResolver;
  private service: MessageRuntimeService;

  constructor(options: Pick<MessageExecutionRuntimeOptions, 'resolveImages' | 'service'>) {
    this.service = options.service;
    this.resolveImages = options.resolveImages;
  }

  /**
   * The newest image attachments of a message page, stored for the model. Never throws: a
   * failed store leaves the images named in the text, and the read still succeeds.
   */
  private async attachImages(messages: MessageItem[] | undefined) {
    const { candidates, total } = collectImageCandidates(messages);
    if (candidates.length === 0 || !this.resolveImages) return { images: [], total };

    try {
      return { images: await this.resolveImages(candidates), total };
    } catch {
      return { images: [], total };
    }
  }

  // ==================== Core Message Operations ====================

  async sendMessage(params: SendMessageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.sendMessage(params);
      const outcome = describeAttachmentOutcome(
        params,
        result,
        `Message sent to ${params.platform}:${params.channelId} (messageId: ${result.messageId})`,
      );
      return { content: outcome.content, state: result, success: outcome.success };
    } catch (e) {
      return {
        content: `sendMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async readMessages(params: ReadMessagesParams): Promise<BuiltinServerRuntimeOutput> {
    if (params.platform === 'discord') {
      if (params.before !== undefined && params.after !== undefined) {
        return {
          content: 'readMessages error: Discord before and after are mutually exclusive.',
          success: false,
        };
      }
      for (const direction of ['before', 'after'] as const) {
        const cursor = params[direction];
        if (cursor !== undefined && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) {
          return {
            content: `readMessages error: Discord ${direction} must be a non-empty decimal message ID string. Omit it when not needed.`,
            success: false,
          };
        }
      }
    }
    try {
      const result = await this.service.readMessages(params);
      const count = result.messages?.length ?? 0;
      const { images, total } = await this.attachImages(result.messages);
      const formatted = formatMessageLines(result.messages, images);

      const paginationHint =
        params.platform === 'discord'
          ? describeDiscordPagination(params, result)
          : result.hasMore && result.nextCursor
            ? `\n\n[More messages available — pass cursor: "${result.nextCursor}" to fetch next page]`
            : '';

      return {
        content: `Fetched ${count} messages from ${params.platform}:${params.channelId}${params.platform === 'discord' ? paginationHint : ''}\n\n${formatted ?? '(no messages)'}${params.platform === 'discord' ? '' : paginationHint}${describeAttachedImages(images, total)}`,
        state: images.length > 0 ? { ...result, images } : result,
        success: true,
      };
    } catch (e) {
      return {
        content: `readMessages error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async readDocument(params: ReadDocumentParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.readDocument) {
      return {
        content: `readDocument is not supported on ${params.platform}`,
        success: false,
      };
    }
    if (!params.url && !params.documentId) {
      return {
        content: 'readDocument error: pass the document `url` (preferred) or its `documentId`',
        success: false,
      };
    }
    try {
      const result = await this.service.readDocument(params);
      const header = [
        `Document${result.title ? `: ${result.title}` : ''}`,
        result.url ? `URL: ${result.url}` : undefined,
        result.documentId
          ? `ID: ${result.documentId}${result.kind ? ` (${result.kind})` : ''}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n');
      const truncatedHint = result.truncated
        ? '\n\n[Content truncated — the document is longer than what fits here]'
        : '';
      return {
        content: `${header}\n\n${result.content?.trim() || '(empty document)'}${truncatedHint}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `readDocument error: ${(e as Error).message}`,
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
      const { images, total } = await this.attachImages(result.messages);
      const formatted = formatMessageLines(result.messages, images);

      return {
        content: `Found ${count} messages matching "${params.query}" in ${params.platform}:${params.channelId}\n\n${formatted ?? '(no results)'}${describeAttachedImages(images, total)}`,
        state: images.length > 0 ? { ...result, images } : result,
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
      const outcome = describeAttachmentOutcome(
        params,
        result,
        `Reply sent to thread ${params.threadId} (messageId: ${result.messageId})`,
      );
      return { content: outcome.content, state: result, success: outcome.success };
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
      const outcome = describeAttachmentOutcome(
        params,
        result,
        `Direct message sent to user ${params.userId} on ${params.platform} (messageId: ${result.messageId})`,
      );
      return { content: outcome.content, state: result, success: outcome.success };
    } catch (e) {
      return {
        content: `sendDirectMessage error: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
