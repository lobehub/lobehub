import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type ChatToolPayload, type CreateMessageParams, type SearchQuery } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<ChatStore>;
export const searchSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new SearchActionImpl(set, get, _api);

export class SearchActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  saveSearchResult = async (id: string): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message || !message.plugin) return;

    const { optimisticAddToolToAssistantMessage, optimisticCreateMessage, openToolUI } =
      this.#get();

    // Get operationId from messageOperationMap
    const operationId = this.#get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // 1. 创建一个新的 tool call message
    const newToolCallId = `tool_call_${nanoid()}`;

    const toolMessage: CreateMessageParams = {
      agentId: message.agentId ?? this.#get().activeAgentId,
      content: message.content,
      id: undefined,
      parentId: message.parentId,
      plugin: message.plugin,
      pluginState: message.pluginState,
      role: 'tool',
      tool_call_id: newToolCallId,
      topicId: message.topicId !== undefined ? message.topicId : this.#get().activeTopicId,
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
  };

  togglePageContent = (url: string): void => {
    this.#set({ activePageContentUrl: url });
  };

  triggerSearchAgain = async (id: string, data: SearchQuery): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message) return;

    // Get operationId from messageOperationMap to ensure proper context isolation
    const operationId = this.#get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // 1. 更新插件参数
    await this.#get().optimisticUpdatePluginArguments(id, data, false, context);

    // 2. 通过 invokeBuiltinTool 调用 Tool Store Executor
    const payload = {
      apiName: WebBrowsingApiName.search,
      arguments: JSON.stringify(data),
      // Use tool_call_id from message, or generate one if not available
      id: message.tool_call_id,
      identifier: WebBrowsingManifest.identifier,
      type: 'builtin',
    } as ChatToolPayload;

    await this.#get().invokeBuiltinTool(id, payload);
  };
}

export type SearchAction = Pick<SearchActionImpl, keyof SearchActionImpl>;
