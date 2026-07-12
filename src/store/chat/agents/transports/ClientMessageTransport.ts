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

import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

/** Client message adapter backed by the optimistic chat store. */
export class ClientMessageTransport implements MessageTransport {
  constructor(
    private readonly get: () => ChatStore,
    private readonly messageKey: string,
    private readonly operationId: string,
  ) {}

  createAssistantMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    return this.createMessage(params);
  }

  createToolMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    return this.createMessage(params);
  }

  async deleteMessage(id: string): Promise<void> {
    await this.get().optimisticDeleteMessage(id, { operationId: this.operationId });
  }

  async findById(id: string): Promise<RuntimeMessageRef | undefined> {
    return this.getMessages().find((message) => message.id === id);
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

    const conversationContext = store.internal_getConversationContext(optimisticContext);
    const result = await messageService.updateMessage(id, params, conversationContext);
    if (result?.success && result.messages) {
      store.replaceMessages(result.messages, { context: conversationContext });
    }
  }

  async updatePluginState(id: string, state: Record<string, any>): Promise<void> {
    await this.get().optimisticUpdatePluginState(id, state, { operationId: this.operationId });
  }

  async updateToolMessage(id: string, params: UpdateToolMessageInput): Promise<void> {
    await this.get().optimisticUpdateToolMessage(
      id,
      {
        ...params,
        pluginError: params.pluginError as ChatMessagePluginError | null | undefined,
      },
      { operationId: this.operationId },
    );
  }

  private async createMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    const result = await this.get().optimisticCreateMessage(params, {
      operationId: this.operationId,
    });

    if (!result) throw new Error(`Failed to create ${params.role} message`);

    return { ...params, id: result.id };
  }

  private getMessages(): UIChatMessage[] {
    return this.get().dbMessagesMap[this.messageKey] ?? [];
  }
}
