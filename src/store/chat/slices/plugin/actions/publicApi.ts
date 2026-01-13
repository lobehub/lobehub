/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type ChatToolPayload, type RuntimeStepContext, type UIChatMessage } from '@lobechat/types';
import i18n from 'i18next';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type OptimisticUpdateContext } from '../../message/actions/optimisticUpdate';
import { displayMessageSelectors } from '../../message/selectors';

/**
 * Public API for plugin operations
 * These methods are called by UI components or other business scenarios
 */
export interface PluginPublicApiAction {
  /**
   * Fill plugin message content and optionally trigger AI message
   * @param id - message id
   * @param content - content to fill
   * @param triggerAiMessage - whether to trigger AI message
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  fillPluginMessageContent: (
    id: string,
    content: string,
    triggerAiMessage?: boolean,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;

  /**
   * Re-invoke a tool message (retry failed plugin call)
   */
  reInvokeToolMessage: (id: string) => Promise<void>;

  /**
   * Summary plugin content using AI
   */
  summaryPluginContent: (id: string) => Promise<void>;

  /**
   * Invoke different type of plugin based on payload type
   * This is the unified entry point for plugin invocation
   *
   * @param id - Tool message ID
   * @param payload - Tool call payload
   * @param stepContext - Optional step context with dynamic state like GTD todos
   */
  internal_invokeDifferentTypePlugin: (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ) => Promise<any>;
}

export const pluginPublicApi: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  PluginPublicApiAction
> = (set, get) => ({
  fillPluginMessageContent: async (id, content, triggerAiMessage, context) => {
    const { triggerAIMessage, optimisticUpdateMessageContent } = get();

    await optimisticUpdateMessageContent(id, content, undefined, context);

    if (triggerAiMessage) await triggerAIMessage({ parentId: id });
  },

  reInvokeToolMessage: async (id) => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!message || message.role !== 'tool' || !message.plugin) return;

    // Get operationId from messageOperationMap
    const operationId = get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // if there is error content, then clear the error
    if (!!message.pluginError) {
      get().optimisticUpdateMessagePluginError(id, null, context);
    }

    const payload: ChatToolPayload = { ...message.plugin, id: message.tool_call_id! };

    await get().internal_invokeDifferentTypePlugin(id, payload);
  },

  summaryPluginContent: async (id) => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(get());
    if (!message || message.role !== 'tool') return;

    const { activeAgentId, activeTopicId, activeThreadId } = get();

    await get().internal_execAgentRuntime({
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
  },

  internal_invokeDifferentTypePlugin: async (id, payload, stepContext) => {
    switch (payload.type) {
      case 'standalone': {
        return await get().invokeStandaloneTypePlugin(id, payload);
      }

      case 'markdown': {
        return await get().invokeMarkdownTypePlugin(id, payload);
      }

      case 'builtin': {
        // Pass stepContext to builtin tools for dynamic state access
        return await get().invokeBuiltinTool(id, payload, stepContext);
      }

      // @ts-ignore
      case 'mcp': {
        return await get().invokeMCPTypePlugin(id, payload);
      }

      default: {
        return await get().invokeDefaultTypePlugin(id, payload);
      }
    }
  },
});
