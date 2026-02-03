/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type ChatToolPayload, type RuntimeStepContext, type UIChatMessage } from '@lobechat/types';
import i18n from 'i18next';

import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { type OptimisticUpdateContext } from '../../message/actions/optimisticUpdate';
import { displayMessageSelectors } from '../../message/selectors';

/**
 * Public API for plugin operations
 * These methods are called by UI components or other business scenarios
 */

type Setter = StoreSetter<ChatStore>;
export const pluginPublicApi = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginPublicApiActionImpl(set, get, _api);

export class PluginPublicApiActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fillPluginMessageContent = async (
    id: string,
    content: string,
    triggerAiMessage?: boolean,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { triggerAIMessage, optimisticUpdateMessageContent } = this.#get();

    await optimisticUpdateMessageContent(id, content, undefined, context);

    if (triggerAiMessage) await triggerAIMessage({ parentId: id });
  };

  reInvokeToolMessage = async (id: string): Promise<void> => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message || message.role !== 'tool' || !message.plugin) return;

    // Get operationId from messageOperationMap
    const operationId = this.#get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // if there is error content, then clear the error
    if (!!message.pluginError) {
      this.#get().optimisticUpdateMessagePluginError(id, null, context);
    }

    const payload: ChatToolPayload = { ...message.plugin, id: message.tool_call_id! };

    await this.#get().internal_invokeDifferentTypePlugin(id, payload);
  };

  summaryPluginContent = async (id: string): Promise<void> => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message || message.role !== 'tool') return;

    const { activeAgentId, activeTopicId, activeThreadId } = this.#get();

    await this.#get().internal_execAgentRuntime({
      context: {
        agentId: activeAgentId,
        topicId: activeTopicId,
        threadId: activeThreadId ?? undefined,
      },
      messages: [
        {
          role: 'assistant',
          content: i18n.t('prompts.summaryExpert', { ns: 'chat' }),
        },
        {
          ...message,
          content: message.content,
          role: 'assistant',
          name: undefined,
          tool_call_id: undefined,
        },
      ] as UIChatMessage[],
      parentMessageId: message.id,
      parentMessageType: 'assistant',
    });
  };

  internal_invokeDifferentTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ): Promise<any> => {
    switch (payload.type) {
      case 'standalone': {
        return await this.#get().invokeStandaloneTypePlugin(id, payload);
      }

      case 'markdown': {
        return await this.#get().invokeMarkdownTypePlugin(id, payload);
      }

      case 'builtin': {
        // Pass stepContext to builtin tools for dynamic state access
        return await this.#get().invokeBuiltinTool(id, payload, stepContext);
      }

      // @ts-ignore
      case 'mcp': {
        return await this.#get().invokeMCPTypePlugin(id, payload);
      }

      default: {
        return await this.#get().invokeDefaultTypePlugin(id, payload);
      }
    }
  };
}

export type PluginPublicApiAction = Pick<
  PluginPublicApiActionImpl,
  keyof PluginPublicApiActionImpl
>;
