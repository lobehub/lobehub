/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { ToolNameResolver } from '@lobechat/context-engine';
import {
  ChatErrorType,
  ChatMessageError,
  ChatToolPayload,
  CreateMessageParams,
  MessageToolCall,
  ToolsCallingContext,
  UIChatMessage,
} from '@lobechat/types';
import { LobeChatPluginManifest, PluginErrorType } from '@lobehub/chat-plugin-sdk';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { StateCreator } from 'zustand/vanilla';

import { chatService } from '@/services/chat';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { builtinTools } from '@/tools';
import { merge } from '@/utils/merge';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { setNamespace } from '@/utils/storeDebug';

import { chatSelectors } from '../message/selectors';
import { threadSelectors } from '../thread/selectors';

const n = setNamespace('plugin');

export interface ChatPluginAction {
  createAssistantMessageByPlugin: (content: string, parentId: string) => Promise<void>;
  fillPluginMessageContent: (
    id: string,
    content: string,
    triggerAiMessage?: boolean,
  ) => Promise<void>;

  invokeBuiltinTool: (id: string, payload: ChatToolPayload) => Promise<void>;
  invokeDefaultTypePlugin: (id: string, payload: any) => Promise<string | undefined>;
  invokeMarkdownTypePlugin: (id: string, payload: ChatToolPayload) => Promise<void>;
  invokeMCPTypePlugin: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;

  invokeStandaloneTypePlugin: (id: string, payload: ChatToolPayload) => Promise<void>;

  reInvokeToolMessage: (id: string) => Promise<void>;
  triggerAIMessage: (params: {
    parentId?: string;
    traceId?: string;
    threadId?: string;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
  }) => Promise<void>;
  summaryPluginContent: (id: string) => Promise<void>;

  /**
   * @deprecated V1 method
   */
  triggerToolCalls: (
    id: string,
    params?: { threadId?: string; inPortalThread?: boolean; inSearchWorkflow?: boolean },
  ) => Promise<void>;
  updatePluginState: (id: string, value: any) => Promise<void>;
  updatePluginArguments: <T = any>(id: string, value: T, replace?: boolean) => Promise<void>;

  internal_addToolToAssistantMessage: (id: string, tool: ChatToolPayload) => Promise<void>;
  internal_removeToolToAssistantMessage: (id: string, tool_call_id?: string) => Promise<void>;
  /**
   * use the optimistic update value to update the message tools to database
   */
  internal_refreshToUpdateMessageTools: (id: string) => Promise<void>;

  internal_callPluginApi: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;
  internal_invokeDifferentTypePlugin: (id: string, payload: ChatToolPayload) => Promise<any>;
  internal_togglePluginApiCalling: (
    loading: boolean,
    id?: string,
    action?: string,
  ) => AbortController | undefined;
  internal_transformToolCalls: (toolCalls: MessageToolCall[]) => ChatToolPayload[];
  internal_updatePluginError: (id: string, error: ChatMessageError) => Promise<void>;
  internal_constructToolsCallingContext: (id: string) => ToolsCallingContext | undefined;
}

export const chatPlugin: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatPluginAction
> = (set, get) => ({
  createAssistantMessageByPlugin: async (content, parentId) => {
    const newMessage: CreateMessageParams = {
      content,
      parentId,
      role: 'assistant',
      sessionId: get().activeId,
      topicId: get().activeTopicId, // if there is activeTopicId，then add it to topicId
    };

    await messageService.createMessage(newMessage);
    await get().refreshMessages();
  },

  fillPluginMessageContent: async (id, content, triggerAiMessage) => {
    const { triggerAIMessage, internal_updateMessageContent } = get();

    await internal_updateMessageContent(id, content);

    if (triggerAiMessage) await triggerAIMessage({ parentId: id });
  },
  invokeBuiltinTool: async (id, payload) => {
    const {
      internal_togglePluginApiCalling,
      internal_updateMessageContent,
      internal_updatePluginError,
    } = get();
    const params = JSON.parse(payload.arguments);
    internal_togglePluginApiCalling(true, id, n('invokeBuiltinTool/start') as string);
    let data;
    try {
      data = await useToolStore.getState().transformApiArgumentsToAiState(payload.apiName, params);
    } catch (error) {
      const err = error as Error;
      console.error(err);

      const tool = builtinTools.find((tool) => tool.identifier === payload.identifier);
      const schema = tool?.manifest?.api.find((api) => api.name === payload.apiName)?.parameters;

      await internal_updatePluginError(id, {
        type: ChatErrorType.PluginFailToTransformArguments,
        body: {
          message:
            "[plugin] fail to transform plugin arguments to ai state, it may due to model's limited tools calling capacity. You can refer to https://lobehub.com/docs/usage/tools-calling for more detail.",
          stack: err.stack,
          arguments: params,
          schema,
        },
        message: '',
      });
    }
    internal_togglePluginApiCalling(false, id, n('invokeBuiltinTool/end') as string);

    if (!data) return;

    await internal_updateMessageContent(id, data);

    // run tool api call
    // postToolCalling
    // @ts-ignore
    const { [payload.apiName]: action } = get();
    if (!action) return;

    let content;

    try {
      content = JSON.parse(data);
    } catch {
      /* empty block */
    }

    if (!content) return;

    return await action(id, content);
  },

  invokeDefaultTypePlugin: async (id, payload) => {
    const { internal_callPluginApi } = get();

    const data = await internal_callPluginApi(id, payload);

    if (!data) return;

    return data;
  },

  invokeMarkdownTypePlugin: async (id, payload) => {
    const { internal_callPluginApi } = get();

    await internal_callPluginApi(id, payload);
  },

  invokeStandaloneTypePlugin: async (id, payload) => {
    const result = await useToolStore.getState().validatePluginSettings(payload.identifier);
    if (!result) return;

    // if the plugin settings is not valid, then set the message with error type
    if (!result.valid) {
      await messageService.updateMessageError(id, {
        body: {
          error: result.errors,
          message: '[plugin] your settings is invalid with plugin manifest setting schema',
        },
        message: t('response.PluginSettingsInvalid', { ns: 'error' }),
        type: PluginErrorType.PluginSettingsInvalid as any,
      });

      await get().refreshMessages();
      return;
    }
  },

  reInvokeToolMessage: async (id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || message.role !== 'tool' || !message.plugin) return;

    // if there is error content, then clear the error
    if (!!message.pluginError) {
      get().internal_updateMessagePluginError(id, null);
    }

    const payload: ChatToolPayload = { ...message.plugin, id: message.tool_call_id! };

    await get().internal_invokeDifferentTypePlugin(id, payload);
  },

  triggerAIMessage: async ({ parentId, traceId, threadId, inPortalThread, inSearchWorkflow }) => {
    const { internal_coreProcessMessage } = get();

    const chats = inPortalThread
      ? threadSelectors.portalAIChatsWithHistoryConfig(get())
      : chatSelectors.mainAIChatsWithHistoryConfig(get());

    await internal_coreProcessMessage(chats, parentId ?? chats.at(-1)!.id, {
      traceId,
      threadId,
      inPortalThread,
      inSearchWorkflow,
    });
  },

  summaryPluginContent: async (id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || message.role !== 'tool') return;

    await get().internal_coreProcessMessage(
      [
        {
          role: 'assistant',
          content: '作为一名总结专家，请结合以上系统提示词，将以下内容进行总结：',
        },
        {
          ...message,
          content: message.content,
          role: 'assistant',
          name: undefined,
          tool_call_id: undefined,
        },
      ] as UIChatMessage[],
      message.id,
    );
  },

  triggerToolCalls: async (assistantId, { threadId, inPortalThread, inSearchWorkflow } = {}) => {
    const message = chatSelectors.getMessageById(assistantId)(get());
    if (!message || !message.tools) return;

    let shouldCreateMessage = false;
    let latestToolId = '';
    const messagePools = message.tools.map(async (payload) => {
      const toolMessage: CreateMessageParams = {
        content: '',
        parentId: assistantId,
        plugin: payload,
        role: 'tool',
        sessionId: get().activeId,
        tool_call_id: payload.id,
        threadId,
        topicId: get().activeTopicId, // if there is activeTopicId，then add it to topicId
        groupId: message.groupId, // Propagate groupId from parent message for group chat
      };

      const id = await get().internal_createMessage(toolMessage);
      if (!id) return;

      // trigger the plugin call
      const data = await get().internal_invokeDifferentTypePlugin(id, payload);

      if (data && !['markdown', 'standalone'].includes(payload.type)) {
        shouldCreateMessage = true;
        latestToolId = id;
      }
    });

    await Promise.all(messagePools);

    await get().internal_toggleMessageInToolsCalling(false, assistantId);

    // only default type tool calls should trigger AI message
    if (!shouldCreateMessage) return;

    const traceId = chatSelectors.getTraceIdByMessageId(latestToolId)(get());

    await get().triggerAIMessage({ traceId, threadId, inPortalThread, inSearchWorkflow });
  },
  updatePluginState: async (id, value) => {
    const { refreshMessages } = get();

    // optimistic update
    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { pluginState: value } });

    await messageService.updateMessagePluginState(id, value);
    await refreshMessages();
  },

  updatePluginArguments: async (id, value, replace = false) => {
    const { refreshMessages } = get();
    const toolMessage = chatSelectors.getMessageById(id)(get());
    if (!toolMessage || !toolMessage?.tool_call_id) return;

    let assistantMessage = chatSelectors.getMessageById(toolMessage?.parentId || '')(get());

    const prevArguments = toolMessage?.plugin?.arguments;
    const prevJson = safeParseJSON(prevArguments || '');
    const nextValue = replace ? (value as any) : merge(prevJson || {}, value);
    if (isEqual(prevJson, nextValue)) return;

    // optimistic update
    get().internal_dispatchMessage({
      id,
      type: 'updateMessagePlugin',
      value: { arguments: JSON.stringify(nextValue) },
    });

    // 同样需要更新 assistantMessage 的 pluginArguments
    if (assistantMessage) {
      get().internal_dispatchMessage({
        id: assistantMessage.id,
        type: 'updateMessageTools',
        tool_call_id: toolMessage?.tool_call_id,
        value: { arguments: JSON.stringify(nextValue) },
      });
      assistantMessage = chatSelectors.getMessageById(assistantMessage?.id)(get());
    }

    const updateAssistantMessage = async () => {
      if (!assistantMessage) return;
      await messageService.updateMessage(assistantMessage!.id, {
        tools: assistantMessage?.tools,
      });
    };

    await Promise.all([
      messageService.updateMessagePluginArguments(id, nextValue),
      updateAssistantMessage(),
    ]);

    await refreshMessages();
  },

  internal_addToolToAssistantMessage: async (id, tool) => {
    const assistantMessage = chatSelectors.getMessageById(id)(get());
    if (!assistantMessage) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = get();
    internal_dispatchMessage({
      type: 'addMessageTool',
      value: tool,
      id: assistantMessage.id,
    });

    await internal_refreshToUpdateMessageTools(id);
  },

  internal_removeToolToAssistantMessage: async (id, tool_call_id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || !tool_call_id) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = get();

    // optimistic update
    internal_dispatchMessage({ type: 'deleteMessageTool', tool_call_id, id: message.id });

    // update the message tools
    await internal_refreshToUpdateMessageTools(id);
  },
  internal_refreshToUpdateMessageTools: async (id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || !message.tools) return;

    const { internal_toggleMessageLoading, refreshMessages } = get();

    internal_toggleMessageLoading(true, id);
    await messageService.updateMessage(id, { tools: message.tools });
    internal_toggleMessageLoading(false, id);

    await refreshMessages();
  },

  internal_callPluginApi: async (id, payload) => {
    const { internal_updateMessageContent, refreshMessages, internal_togglePluginApiCalling } =
      get();
    let data: string;

    try {
      const abortController = internal_togglePluginApiCalling(
        true,
        id,
        n('fetchPlugin/start') as string,
      );

      const message = chatSelectors.getMessageById(id)(get());

      const res = await chatService.runPluginApi(payload, {
        signal: abortController?.signal,
        trace: { observationId: message?.observationId, traceId: message?.traceId },
      });
      data = res.text;

      // save traceId
      if (res.traceId) {
        await messageService.updateMessage(id, { traceId: res.traceId });
      }
    } catch (error) {
      console.log(error);
      const err = error as Error;

      // ignore the aborted request error
      if (!err.message.includes('The user aborted a request.')) {
        await messageService.updateMessageError(id, error as any);
        await refreshMessages();
      }

      data = '';
    }

    internal_togglePluginApiCalling(false, id, n('fetchPlugin/end') as string);
    // 如果报错则结束了
    if (!data) return;

    await internal_updateMessageContent(id, data);

    return data;
  },

  internal_invokeDifferentTypePlugin: async (id, payload) => {
    switch (payload.type) {
      case 'standalone': {
        return await get().invokeStandaloneTypePlugin(id, payload);
      }

      case 'markdown': {
        return await get().invokeMarkdownTypePlugin(id, payload);
      }

      case 'builtin': {
        return await get().invokeBuiltinTool(id, payload);
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
  invokeMCPTypePlugin: async (id, payload) => {
    const {
      internal_updateMessageContent,
      refreshMessages,
      internal_togglePluginApiCalling,
      internal_constructToolsCallingContext,
    } = get();
    let data: string = '';

    try {
      const abortController = internal_togglePluginApiCalling(
        true,
        id,
        n('fetchPlugin/start') as string,
      );

      const context = internal_constructToolsCallingContext(id);
      const result = await mcpService.invokeMcpToolCall(payload, {
        signal: abortController?.signal,
        topicId: context?.topicId,
      });

      if (!!result) data = result;
    } catch (error) {
      console.log(error);
      const err = error as Error;

      // ignore the aborted request error
      if (!err.message.includes('The user aborted a request.')) {
        await messageService.updateMessageError(id, error as any);
        await refreshMessages();
      }
    }

    internal_togglePluginApiCalling(false, id, n('fetchPlugin/end') as string);
    // 如果报错则结束了
    if (!data) return;

    await internal_updateMessageContent(id, data);

    return data;
  },

  internal_togglePluginApiCalling: (loading, id, action) => {
    return get().internal_toggleLoadingArrays('pluginApiLoadingIds', loading, id, action);
  },

  internal_transformToolCalls: (toolCalls) => {
    const toolNameResolver = new ToolNameResolver();

    // Build manifests map from tool store
    const toolStoreState = useToolStore.getState();
    const manifests: Record<string, LobeChatPluginManifest> = {};

    // Get all installed plugins
    const installedPlugins = pluginSelectors.installedPlugins(toolStoreState);
    for (const plugin of installedPlugins) {
      if (plugin.manifest) {
        manifests[plugin.identifier] = plugin.manifest as LobeChatPluginManifest;
      }
    }

    // Get all builtin tools
    for (const tool of builtinTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as LobeChatPluginManifest;
      }
    }

    return toolNameResolver.resolve(toolCalls, manifests);
  },
  internal_updatePluginError: async (id, error) => {
    const { refreshMessages } = get();

    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } });
    await messageService.updateMessage(id, { error });
    await refreshMessages();
  },

  internal_constructToolsCallingContext: (id: string) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    return {
      topicId: message.topicId,
    };
  },
});
