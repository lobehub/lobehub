/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type CreateMessageParams } from '@lobechat/types';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { dbMessageSelectors, displayMessageSelectors } from '../../message/selectors';
import { threadSelectors } from '../../thread/selectors';

/**
 * Workflow orchestration actions
 * Handle complex business flows involving multiple steps
 */

type Setter = StoreSetter<ChatStore>;
export const pluginWorkflow = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginWorkflowActionImpl(set, get, _api);

export class PluginWorkflowActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createAssistantMessageByPlugin = async (content: string, parentId: string): Promise<void> => {
    // Get parent message to extract agentId/topicId
    const parentMessage = dbMessageSelectors.getDbMessageById(parentId)(this.#get());

    const newMessage: CreateMessageParams = {
      content,
      parentId,
      role: 'assistant',
      agentId: parentMessage?.agentId ?? this.#get().activeAgentId,
      topicId:
        parentMessage?.topicId !== undefined ? parentMessage.topicId : this.#get().activeTopicId,
    };

    const result = await messageService.createMessage(newMessage);
    this.#get().replaceMessages(result.messages, {
      context: { agentId: newMessage.agentId, topicId: newMessage.topicId },
    });
  };

  triggerAIMessage = async ({
    parentId,
    threadId,
    inPortalThread,
    inSearchWorkflow,
  }: {
    parentId?: string;
    threadId?: string;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
  } = {}): Promise<void> => {
    const { internal_execAgentRuntime, activeAgentId, activeTopicId } = this.#get();

    const chats = inPortalThread
      ? threadSelectors.portalAIChatsWithHistoryConfig(this.#get())
      : displayMessageSelectors.mainAIChatsWithHistoryConfig(this.#get());

    await internal_execAgentRuntime({
      context: {
        agentId: activeAgentId,
        topicId: activeTopicId,
        threadId,
      },
      messages: chats,
      parentMessageId: parentId ?? chats.at(-1)!.id,
      parentMessageType: 'user',
      inPortalThread,
      inSearchWorkflow,
    });
  };
}

export type PluginWorkflowAction = Pick<PluginWorkflowActionImpl, keyof PluginWorkflowActionImpl>;
