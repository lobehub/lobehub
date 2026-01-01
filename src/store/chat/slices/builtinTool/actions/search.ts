import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type ChatToolPayload, type CreateMessageParams, type SearchQuery } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { type StateCreator } from 'zustand/vanilla';

import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';

export interface SearchAction {
  saveSearchResult: (id: string) => Promise<void>;
  togglePageContent: (url: string) => void;
  triggerSearchAgain: (
    id: string,
    data: SearchQuery,
    options?: { aiSummary: boolean },
  ) => Promise<void>;
}

export const searchSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  SearchAction
> = (set, get) => ({
  saveSearchResult: async (id) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message || !message.plugin) return;

    const { optimisticAddToolToAssistantMessage, optimisticCreateMessage, openToolUI } = get();

    // Get operationId from messageOperationMap
    const operationId = get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // 1. 创建一个新的 tool call message
    const newToolCallId = `tool_call_${nanoid()}`;

    const toolMessage: CreateMessageParams = {
      agentId: message.agentId ?? get().activeAgentId,
      content: message.content,
      id: undefined,
      parentId: message.parentId,
      plugin: message.plugin,
      pluginState: message.pluginState,
      role: 'tool',
      tool_call_id: newToolCallId,
      topicId: message.topicId !== undefined ? message.topicId : get().activeTopicId,
    };

    const addToolItem = async () => {
      if (!message.parentId || !message.plugin) return;

      await optimisticAddToolToAssistantMessage(
        message.parentId,
        {
          id: newToolCallId,
          ...message.plugin,
        },
        context,
      );
    };

    const [result] = await Promise.all([
      // 1. 添加 tool message
      optimisticCreateMessage(toolMessage, context),
      // 2. 将这条 tool call message 插入到 ai 消息的 tools 中
      addToolItem(),
    ]);
    if (!result) return;

    // 将新创建的 tool message 激活
    openToolUI(result.id, message.plugin.identifier);
  },

  togglePageContent: (url) => {
    set({ activePageContentUrl: url });
  },

  triggerSearchAgain: async (id, data) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message) return;

    // Get operationId from messageOperationMap to ensure proper context isolation
    const operationId = get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // 1. 更新插件参数
    await get().optimisticUpdatePluginArguments(id, data, false, context);

    // 2. 通过 invokeBuiltinTool 调用 Tool Store Executor
    const payload = {
      apiName: WebBrowsingApiName.search,
      arguments: JSON.stringify(data),
      // Use tool_call_id from message, or generate one if not available
      id: message.tool_call_id,
      identifier: WebBrowsingManifest.identifier,
      type: 'builtin',
    } as ChatToolPayload;

    await get().invokeBuiltinTool(id, payload);
  },
});
