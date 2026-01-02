/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type CreateMessageParams } from '@lobechat/types';
import { type StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';

import { dbMessageSelectors, displayMessageSelectors } from '../../message/selectors';
import { threadSelectors } from '../../thread/selectors';

/**
 * Workflow orchestration actions
 * Handle complex business flows involving multiple steps
 */
export interface PluginWorkflowAction {
  /**
   * Create an assistant message by plugin result
   */
  createAssistantMessageByPlugin: (content: string, parentId: string) => Promise<void>;

  /**
   * Trigger AI message after tool calls
   */
  triggerAIMessage: (params: {
    parentId?: string;
    traceId?: string;
    threadId?: string;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
  }) => Promise<void>;
}

export const pluginWorkflow: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  PluginWorkflowAction
> = (set, get) => ({
  createAssistantMessageByPlugin: async (content, parentId) => {
    // Get parent message to extract agentId/topicId
    const parentMessage = dbMessageSelectors.getDbMessageById(parentId)(get());

    const newMessage: CreateMessageParams = {
      content,
      parentId,
      role: 'assistant',
      agentId: parentMessage?.agentId ?? get().activeAgentId,
      topicId: parentMessage?.topicId !== undefined ? parentMessage.topicId : get().activeTopicId,
    };

    const result = await messageService.createMessage(newMessage);
    get().replaceMessages(result.messages, {
      context: { agentId: newMessage.agentId, topicId: newMessage.topicId },
    });
  },

  triggerAIMessage: async ({ parentId, threadId, inPortalThread, inSearchWorkflow }) => {
    const { internal_execAgentRuntime, activeAgentId, activeTopicId } = get();

    const chats = inPortalThread
      ? threadSelectors.portalAIChatsWithHistoryConfig(get())
      : displayMessageSelectors.mainAIChatsWithHistoryConfig(get());

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
  },
});
