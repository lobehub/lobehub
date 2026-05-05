import { type CreateMessageParams } from '@lobechat/types';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { dbMessageSelectors } from '../../message/selectors';

/**
 * Workflow orchestration actions
 * Handle complex business flows involving multiple steps
 */

type Setter = StoreSetter<ChatStore>;
export const pluginWorkflow = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginWorkflowActionImpl(set, get, _api);

export class PluginWorkflowActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
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
}

export type PluginWorkflowAction = Pick<PluginWorkflowActionImpl, keyof PluginWorkflowActionImpl>;
