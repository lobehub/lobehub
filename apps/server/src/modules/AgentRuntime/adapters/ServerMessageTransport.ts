import type {
  CreateAssistantMessageOptions,
  MessageTransport,
  QueryMessagesInput,
  QueryMessagesOptions,
  RuntimeMessageRef,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';

import { type MessageModel } from '@/database/models/message';

import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
} from '../messagePersistErrors';
import { unwrapPgError } from '../pgError';

/**
 * Server {@link MessageTransport} adapter — delegates to `MessageModel` (DB).
 */
export class ServerMessageTransport implements MessageTransport {
  constructor(
    private readonly messageModel: MessageModel,
    private readonly options: {
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
    } = {},
  ) {}

  /**
   * Reuses the first persisted placeholder when an at-least-once step delivery
   * retries after message creation but before the runtime state is committed.
   */
  async createAssistantMessage(
    params: CreateMessageParams,
    options?: CreateAssistantMessageOptions,
  ): Promise<RuntimeMessageRef> {
    const idempotencyKey = options?.idempotencyKey;
    const createParams = idempotencyKey ? { ...params, clientId: idempotencyKey } : params;

    try {
      return await this.messageModel.create(createParams);
    } catch (error) {
      const pgError = unwrapPgError(error);
      const isIdempotencyConflict =
        idempotencyKey &&
        pgError?.code === '23505' &&
        pgError.constraint === 'message_client_id_user_unique';

      if (!isIdempotencyConflict) throw error;

      const existingMessage = await this.messageModel.findByClientId(idempotencyKey);
      if (!existingMessage) throw error;

      return {
        agentId: existingMessage.agentId,
        groupId: existingMessage.groupId,
        id: existingMessage.id,
        model: existingMessage.model,
        parentId: existingMessage.parentId,
        provider: existingMessage.provider,
        role: existingMessage.role,
        threadId: existingMessage.threadId,
        topicId: existingMessage.topicId,
      };
    }
  }

  async createToolMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    try {
      return await this.messageModel.create(params);
    } catch (error) {
      if (typeof params.parentId === 'string' && isMidOperationReferenceMissingError(error)) {
        throw createConversationParentMissingError(params.parentId, error);
      }
      throw error;
    }
  }

  async deleteMessage(id: string): Promise<void> {
    // Runtime cleanup path (orphaned placeholders / approval teardown). Agent-share
    // visitor turns run under the creator's identity, so the runtime must be able to
    // delete rows the creator-facing delete guard fails closed on.
    await this.messageModel.deleteMessage(id, { includeShareVisitor: true });
  }

  async findToolMessageIdByToolCallId(
    toolCallId: string,
    parentMessageId: string,
  ): Promise<string | undefined> {
    // Indexed on `message_plugins_tool_call_id_idx`; the model already uses this
    // lookup for card updates, so the abort path adds no new access pattern.
    const id = await this.messageModel.findToolMessageIdByToolCallId(toolCallId, parentMessageId);
    return id ?? undefined;
  }

  async findById(id: string): Promise<RuntimeMessageRef | undefined> {
    const message = await this.messageModel.findById(id);
    return message
      ? {
          agentId: message.agentId,
          groupId: message.groupId,
          id: message.id,
          model: message.model,
          parentId: message.parentId,
          provider: message.provider,
          role: message.role,
          threadId: message.threadId,
          topicId: message.topicId,
        }
      : undefined;
  }

  async query(
    params?: QueryMessagesInput,
    options?: QueryMessagesOptions,
  ): Promise<UIChatMessage[]> {
    const messages = await this.messageModel.query(params, {
      // Executors only ever read the operation's own, already-authorized topic.
      // An agent-share visitor run executes under the CREATOR's identity, so
      // without this opt-in `query()`'s creator-facing agent-share exclusion
      // would blank the visitor's conversation mid-run (see `tool.ts`, which
      // re-reads `state.messages` from the DB after every tool call).
      allowShareVisitor: true,
      postProcessUrl: options?.resolveAssetUrls ? this.options.postProcessUrl : undefined,
    });

    if (!options?.flatten) return messages;

    const { flatList } = parse(messages);
    return flatList;
  }

  async update(id: string, params: Partial<UpdateMessageParams>): Promise<void> {
    await this.messageModel.update(id, params);
  }

  async updatePluginState(id: string, state: Record<string, any>): Promise<void> {
    await this.messageModel.updatePluginState(id, state);
  }

  async updateToolIntervention(id: string, intervention: Record<string, any>): Promise<void> {
    await this.messageModel.updateMessagePlugin(id, { intervention } as any);
  }

  async updateToolMessage(id: string, params: UpdateToolMessageInput): Promise<void> {
    await this.messageModel.updateToolMessage(id, params);
  }
}
