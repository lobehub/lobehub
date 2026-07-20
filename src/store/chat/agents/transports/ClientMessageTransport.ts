import type {
  MessageTransport,
  QueryMessagesInput,
  QueryMessagesOptions,
  RuntimeMessageRef,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import type {
  ChatMessagePluginError,
  CreateMessageParams,
  UIChatMessage,
  UpdateMessageParams,
} from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { type MessageBatchOperation, messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

/** Client message adapter backed by the optimistic chat store. */
export class ClientMessageTransport implements MessageTransport {
  constructor(
    private readonly get: () => ChatStore,
    private readonly messageKey: string,
    private readonly operationId: string,
  ) {}

  createAssistantMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    const operation = this.get().operations[this.operationId];
    if (!operation) throw new Error(`Operation not found: ${this.operationId}`);

    const { agentId, groupId, isSupervisor, scope, subAgentId, threadId, topicId } =
      operation.context;
    const effectiveAgentId = subAgentId && scope !== 'sub_agent' ? subAgentId : agentId;
    const metadata = {
      ...params.metadata,
      ...(isSupervisor && { isSupervisor: true }),
      ...(scope === 'sub_agent' && subAgentId && { scope, subAgentId }),
    };

    return this.createMessage({
      ...params,
      ...(effectiveAgentId && { agentId: effectiveAgentId }),
      ...(groupId && { groupId }),
      ...(Object.keys(metadata).length > 0 && { metadata }),
      ...(threadId && { threadId }),
      ...(topicId && { topicId }),
    });
  }

  createToolMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    return this.createMessage(params);
  }

  createToolMessageForOperation(
    params: CreateMessageParams,
    operationId: string,
  ): Promise<RuntimeMessageRef> {
    return this.createMessage(params, operationId);
  }

  async deleteMessage(id: string): Promise<void> {
    await this.get().optimisticDeleteMessage(id, { operationId: this.operationId });
  }

  async findById(id: string): Promise<RuntimeMessageRef | undefined> {
    for (const message of this.getMessages()) {
      if (message.id === id) return message;

      const compressedMessage = message.compressedMessages?.find((item) => item.id === id);
      if (compressedMessage) return compressedMessage;
    }

    return undefined;
  }

  async query(
    _params?: QueryMessagesInput,
    _options?: QueryMessagesOptions,
  ): Promise<UIChatMessage[]> {
    return this.getMessages();
  }

  async update(id: string, params: Partial<UpdateMessageParams>): Promise<void> {
    const store = this.get();
    const optimisticContext = { operationId: this.operationId };

    store.internal_dispatchMessage(
      { id, type: 'updateMessage', value: params as Partial<UIChatMessage> },
      optimisticContext,
    );

    await this.persist([{ id, type: 'updateMessage', value: params }]);
  }

  async updatePluginState(id: string, state: Record<string, any>): Promise<void> {
    this.get().internal_dispatchMessage(
      { id, type: 'updateMessage', value: { pluginState: state } },
      { operationId: this.operationId },
    );

    await this.persist([{ id, type: 'updateToolMessage', value: { pluginState: state } }]);
  }

  async updateToolMessage(id: string, params: UpdateToolMessageInput): Promise<void> {
    const store = this.get();
    const optimisticContext = { operationId: this.operationId };
    const pluginError = params.pluginError as ChatMessagePluginError | null | undefined;

    store.internal_dispatchMessage(
      {
        id,
        type: 'updateMessage',
        value: {
          content: params.content,
          metadata: params.metadata,
          pluginState: params.pluginState,
        },
      },
      optimisticContext,
    );

    if (pluginError !== undefined) {
      store.internal_dispatchMessage(
        { id, type: 'updateMessagePlugin', value: { error: pluginError } },
        optimisticContext,
      );
    }

    await this.persist([
      {
        id,
        type: 'updateToolMessage',
        value: { ...params, pluginError },
      },
    ]);
  }

  private async createMessage(
    params: CreateMessageParams,
    operationId = this.operationId,
  ): Promise<RuntimeMessageRef> {
    const store = this.get();
    const id = params.id ?? nanoid();
    const message = { ...params, id };
    const optimisticContext = { operationId };

    store.internal_dispatchMessage(
      { id, type: 'createMessage', value: { ...message } },
      optimisticContext,
    );

    try {
      await this.persist([{ message, type: 'createMessage' }]);
    } catch (error) {
      const createError = new Error(`Failed to create ${params.role} message`, { cause: error });
      store.internal_dispatchMessage(
        {
          id,
          type: 'updateMessage',
          value: {
            error: {
              body: error,
              message: createError.message,
              type: ChatErrorType.CreateMessageError,
            },
          },
        },
        optimisticContext,
      );
      throw createError;
    }

    return message;
  }

  private async persist(operations: MessageBatchOperation[]): Promise<void> {
    await messageService.batchMutateOrThrow(operations);
  }

  private getMessages(): UIChatMessage[] {
    return this.get().dbMessagesMap[this.messageKey] ?? [];
  }
}
