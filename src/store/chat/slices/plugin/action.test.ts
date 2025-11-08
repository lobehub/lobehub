import {
  DEFAULT_INBOX_AVATAR,
  PLUGIN_SCHEMA_API_MD5_PREFIX,
  PLUGIN_SCHEMA_SEPARATOR,
} from '@lobechat/const';
import { ToolNameResolver } from '@lobechat/context-engine';
import { ChatToolPayload, MessageToolCall, UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { Mock, afterEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { chatSelectors } from '@/store/chat/selectors';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useToolStore } from '@/store/tool';

const invokeStandaloneTypePlugin = useChatStore.getState().invokeStandaloneTypePlugin;

vi.mock('zustand/traditional');

// Mock messageService
vi.mock('@/services/message', () => ({
  messageService: {
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
    updateMessagePluginState: vi.fn(),
    updateMessagePluginArguments: vi.fn(),
    createMessage: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatPluginAction', () => {
  describe('summaryPluginContent', () => {
    it('should summarize plugin content', async () => {
      const messageId = 'message-id';
      const toolMessage = {
        id: messageId,
        role: 'tool',
        content: 'Tool content to summarize',
      } as UIChatMessage;

      const internal_coreProcessMessageMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          messagesMap: { [messageMapKey('session-id')]: [toolMessage] },
          internal_coreProcessMessage: internal_coreProcessMessageMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.summaryPluginContent(messageId);
      });

      expect(internal_coreProcessMessageMock).toHaveBeenCalledWith(
        [
          {
            role: 'assistant',
            content: '作为一名总结专家，请结合以上系统提示词，将以下内容进行总结：',
          },
          {
            ...toolMessage,
            meta: {
              avatar: DEFAULT_INBOX_AVATAR,
              backgroundColor: 'rgba(0,0,0,0)',
              description: undefined,
              title: undefined,
            },
            content: toolMessage.content,
            role: 'assistant',
            name: undefined,
            tool_call_id: undefined,
          },
        ],
        messageId,
      );
    });

    it('should not summarize non-tool messages', async () => {
      const messageId = 'message-id';
      const nonToolMessage = {
        id: messageId,
        role: 'user',
        content: 'User message',
      } as UIChatMessage;

      const internal_coreProcessMessageMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          messagesMap: { [messageMapKey('session-id')]: [nonToolMessage] },
          internal_coreProcessMessage: internal_coreProcessMessageMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.summaryPluginContent(messageId);
      });

      expect(internal_coreProcessMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('internal_togglePluginApiCalling', () => {
    it('should toggle plugin API calling state', () => {
      const internal_toggleLoadingArraysMock = vi.fn();

      act(() => {
        useChatStore.setState({
          internal_toggleLoadingArrays: internal_toggleLoadingArraysMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const action = 'test-action';

      result.current.internal_togglePluginApiCalling(true, messageId, action);

      expect(internal_toggleLoadingArraysMock).toHaveBeenCalledWith(
        'pluginApiLoadingIds',
        true,
        messageId,
        action,
      );

      result.current.internal_togglePluginApiCalling(false, messageId, action);

      expect(internal_toggleLoadingArraysMock).toHaveBeenCalledWith(
        'pluginApiLoadingIds',
        false,
        messageId,
        action,
      );
    });
  });

  describe('fillPluginMessageContent', () => {
    it('should update message content and trigger the ai message', async () => {
      // 设置模拟函数的返回值
      const mockCurrentChats: any[] = [];
      vi.spyOn(chatSelectors, 'activeBaseChats').mockReturnValue(mockCurrentChats);

      // 设置初始状态
      const initialState = {
        messages: [],
        internal_coreProcessMessage: vi.fn(),
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.fillPluginMessageContent(messageId, newContent, true);
      });

      // 验证 messageService.internal_updateMessageContent 是否被正确调用
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { content: newContent });

      // 验证 refreshMessages 是否被调用
      expect(result.current.refreshMessages).toHaveBeenCalled();

      // 验证 coreProcessMessage 是否被正确调用
      expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
        mockCurrentChats,
        messageId,
        {},
      );
    });
    it('should update message content and not trigger ai message', async () => {
      // 设置模拟函数的返回值
      const mockCurrentChats: any[] = [];
      vi.spyOn(chatSelectors, 'activeBaseChats').mockReturnValue(mockCurrentChats);

      // 设置初始状态
      const initialState = {
        messages: [],
        coreProcessMessage: vi.fn(),
        internal_coreProcessMessage: vi.fn(),
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.fillPluginMessageContent(messageId, newContent);
      });

      // 验证 messageService.internal_updateMessageContent 是否被正确调用
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { content: newContent });

      // 验证 refreshMessages 是否被调用
      expect(result.current.refreshMessages).toHaveBeenCalled();

      // 验证 coreProcessMessage 没有被正确调用
      expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
    });
  });

  describe('invokeDefaultTypePlugin', () => {
    it('should run the default plugin type and update message content', async () => {
      const pluginPayload = { apiName: 'testApi', arguments: { key: 'value' } };
      const messageId = 'message-id';
      const pluginApiResponse = 'Plugin API response';

      const storeState = useChatStore.getState();

      vi.spyOn(storeState, 'refreshMessages');
      vi.spyOn(storeState, 'triggerAIMessage').mockResolvedValue(undefined);
      vi.spyOn(storeState, 'internal_togglePluginApiCalling').mockReturnValue(undefined);

      const runSpy = vi.spyOn(chatService, 'runPluginApi').mockResolvedValue({
        text: pluginApiResponse,
        traceId: '',
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeDefaultTypePlugin(messageId, pluginPayload);
      });

      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        true,
        messageId,
        expect.any(String),
      );
      expect(runSpy).toHaveBeenCalledWith(pluginPayload, { signal: undefined, trace: {} });
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, {
        content: pluginApiResponse,
      });
      expect(storeState.refreshMessages).toHaveBeenCalled();
      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        false,
        'message-id',
        'plugin/fetchPlugin/end',
      );
    });

    it('should handle errors when the plugin API call fails', async () => {
      const pluginPayload = { apiName: 'testApi', arguments: { key: 'value' } };
      const messageId = 'message-id';
      const error = new Error('API call failed');

      const storeState = useChatStore.getState();
      vi.spyOn(storeState, 'refreshMessages');
      vi.spyOn(storeState, 'triggerAIMessage').mockResolvedValue(undefined);
      vi.spyOn(storeState, 'internal_togglePluginApiCalling').mockReturnValue(undefined);

      vi.spyOn(chatService, 'runPluginApi').mockRejectedValue(error);

      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        await result.current.invokeDefaultTypePlugin(messageId, pluginPayload);
      });

      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        true,
        messageId,
        expect.any(String),
      );
      expect(chatService.runPluginApi).toHaveBeenCalledWith(pluginPayload, { trace: {} });
      expect(messageService.updateMessageError).toHaveBeenCalledWith(messageId, error);
      expect(storeState.refreshMessages).toHaveBeenCalled();
      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        false,
        'message-id',
        'plugin/fetchPlugin/end',
      );
      expect(storeState.triggerAIMessage).not.toHaveBeenCalled(); // 确保在错误情况下不调用此方法
    });
  });

  describe('triggerToolCalls', () => {
    it('should trigger tool calls for the assistant message', async () => {
      const assistantId = 'assistant-id';
      const message = {
        id: assistantId,
        role: 'assistant',
        content: 'Assistant message',
        tools: [
          {
            id: 'tool1',
            type: 'standalone',
            identifier: 'plugin1',
            apiName: 'api1',
            arguments: '{}',
          },
          {
            id: 'tool2',
            type: 'markdown',
            identifier: 'plugin2',
            apiName: 'api2',
            arguments: '{}',
          },
          {
            id: 'tool3',
            type: 'builtin',
            identifier: 'builtin1',
            apiName: 'api3',
            arguments: '{}',
          },
          {
            id: 'tool4',
            type: 'default',
            identifier: 'plugin3',
            apiName: 'api4',
            arguments: '{}',
          },
        ],
      } as UIChatMessage;

      const invokeStandaloneTypePluginMock = vi.fn();
      const invokeMarkdownTypePluginMock = vi.fn();
      const invokeBuiltinToolMock = vi.fn();
      const invokeDefaultTypePluginMock = vi.fn().mockResolvedValue('Default tool response');
      const triggerAIMessageMock = vi.fn();
      const internal_createMessageMock = vi.fn().mockResolvedValue('tool-message-id');
      const getTraceIdByMessageIdMock = vi.fn().mockReturnValue('trace-id');

      act(() => {
        useChatStore.setState({
          messagesMap: {
            [messageMapKey('session-id', 'topic-id')]: [message],
          },
          invokeStandaloneTypePlugin: invokeStandaloneTypePluginMock,
          invokeMarkdownTypePlugin: invokeMarkdownTypePluginMock,
          invokeBuiltinTool: invokeBuiltinToolMock,
          invokeDefaultTypePlugin: invokeDefaultTypePluginMock,
          triggerAIMessage: triggerAIMessageMock,
          internal_createMessage: internal_createMessageMock,
          activeId: 'session-id',
          activeTopicId: 'topic-id',
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.triggerToolCalls(assistantId);
      });

      // Verify that tool messages were created for each tool call
      expect(internal_createMessageMock).toHaveBeenCalledTimes(4);
      expect(internal_createMessageMock).toHaveBeenNthCalledWith(1, {
        content: '',
        parentId: assistantId,
        plugin: message.tools![0],
        role: 'tool',
        sessionId: 'session-id',
        tool_call_id: 'tool1',
        topicId: 'topic-id',
        threadId: undefined,
        groupId: undefined,
      });
      expect(internal_createMessageMock).toHaveBeenNthCalledWith(2, {
        content: '',
        parentId: assistantId,
        plugin: message.tools![1],
        role: 'tool',
        sessionId: 'session-id',
        tool_call_id: 'tool2',
        topicId: 'topic-id',
        threadId: undefined,
        groupId: undefined,
      });
      expect(internal_createMessageMock).toHaveBeenNthCalledWith(3, {
        content: '',
        parentId: assistantId,
        plugin: message.tools![2],
        role: 'tool',
        sessionId: 'session-id',
        tool_call_id: 'tool3',
        topicId: 'topic-id',
        threadId: undefined,
        groupId: undefined,
      });
      expect(internal_createMessageMock).toHaveBeenNthCalledWith(4, {
        content: '',
        parentId: assistantId,
        plugin: message.tools![3],
        role: 'tool',
        sessionId: 'session-id',
        tool_call_id: 'tool4',
        topicId: 'topic-id',
        threadId: undefined,
        groupId: undefined,
      });

      // Verify that the appropriate plugin types were invoked
      expect(invokeStandaloneTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![0],
      );
      expect(invokeMarkdownTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![1],
      );
      expect(invokeBuiltinToolMock).toHaveBeenCalledWith('tool-message-id', message.tools![2]);
      expect(invokeDefaultTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![3],
      );

      // Verify that AI message was triggered for default type tool call
      // expect(getTraceIdByMessageIdMock).toHaveBeenCalledWith('tool-message-id');
      // expect(triggerAIMessageMock).toHaveBeenCalledWith({ traceId: 'trace-id' });
    });

    it('should not trigger AI message if no default type tool calls', async () => {
      const assistantId = 'assistant-id';
      const message = {
        id: assistantId,
        role: 'assistant',
        content: 'Assistant message',
        tools: [
          {
            id: 'tool1',
            type: 'standalone',
            identifier: 'plugin1',
            apiName: 'api1',
            arguments: '{}',
          },
          {
            id: 'tool2',
            type: 'markdown',
            identifier: 'plugin2',
            apiName: 'api2',
            arguments: '{}',
          },
          {
            id: 'tool3',
            type: 'builtin',
            identifier: 'builtin1',
            apiName: 'api3',
            arguments: '{}',
          },
        ],
      } as UIChatMessage;

      const invokeStandaloneTypePluginMock = vi.fn();
      const invokeMarkdownTypePluginMock = vi.fn();
      const invokeBuiltinToolMock = vi.fn();
      const triggerAIMessageMock = vi.fn();
      const internal_createMessageMock = vi.fn().mockResolvedValue('tool-message-id');

      act(() => {
        useChatStore.setState({
          invokeStandaloneTypePlugin: invokeStandaloneTypePluginMock,
          invokeMarkdownTypePlugin: invokeMarkdownTypePluginMock,
          invokeBuiltinTool: invokeBuiltinToolMock,
          triggerAIMessage: triggerAIMessageMock,
          internal_createMessage: internal_createMessageMock,
          activeId: 'session-id',
          messagesMap: {
            [messageMapKey('session-id', 'topic-id')]: [message],
          },
          activeTopicId: 'topic-id',
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.triggerToolCalls(assistantId);
      });

      // Verify that tool messages were created for each tool call
      expect(internal_createMessageMock).toHaveBeenCalledTimes(3);

      // Verify that the appropriate plugin types were invoked
      expect(invokeStandaloneTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![0],
      );
      expect(invokeMarkdownTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![1],
      );
      expect(invokeBuiltinToolMock).toHaveBeenCalledWith('tool-message-id', message.tools![2]);

      // Verify that AI message was not triggered
      expect(triggerAIMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('updatePluginState', () => {
    it('should update the plugin state for a message', async () => {
      const messageId = 'message-id';
      const pluginStateValue = { key: 'value' };

      const initialState = {
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.updatePluginState(messageId, pluginStateValue);
      });

      expect(messageService.updateMessagePluginState).toHaveBeenCalledWith(
        messageId,
        pluginStateValue,
      );
      expect(initialState.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('createAssistantMessageByPlugin', () => {
    it('should create an assistant message and refresh messages', async () => {
      // 模拟 messageService.create 方法的实现
      (messageService.createMessage as Mock).mockResolvedValue({});

      // 设置初始状态并模拟 refreshMessages 方法
      const initialState = {
        refreshMessages: vi.fn(),
        activeId: 'session-id',
        activeTopicId: 'topic-id',
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const content = 'Test content';
      const parentId = 'parent-message-id';

      await act(async () => {
        await result.current.createAssistantMessageByPlugin(content, parentId);
      });

      // 验证 messageService.create 是否被带有正确参数调用
      expect(messageService.createMessage).toHaveBeenCalledWith({
        content,
        parentId,
        role: 'assistant',
        sessionId: initialState.activeId,
        topicId: initialState.activeTopicId,
      });

      // 验证 refreshMessages 是否被调用
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('should handle errors when message creation fails', async () => {
      // 模拟 messageService.create 方法，使其抛出错误
      const errorMessage = 'Failed to create message';
      (messageService.createMessage as Mock).mockRejectedValue(new Error(errorMessage));

      // 设置初始状态并模拟 refreshMessages 方法
      const initialState = {
        refreshMessages: vi.fn(),
        activeId: 'session-id',
        activeTopicId: 'topic-id',
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const content = 'Test content';
      const parentId = 'parent-message-id';

      await act(async () => {
        await expect(
          result.current.createAssistantMessageByPlugin(content, parentId),
        ).rejects.toThrow(errorMessage);
      });

      // 验证 messageService.create 是否被带有正确参数调用
      expect(messageService.createMessage).toHaveBeenCalledWith({
        content,
        parentId,
        role: 'assistant',
        sessionId: initialState.activeId,
        topicId: initialState.activeTopicId,
      });

      // 验证 refreshMessages 是否没有被调用
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('invokeBuiltinTool', () => {
    it('should invoke a builtin tool and update message content ,then run text2image', async () => {
      const payload = {
        apiName: 'text2image',
        arguments: JSON.stringify({ key: 'value' }),
      } as ChatToolPayload;

      const messageId = 'message-id';
      const toolResponse = JSON.stringify({ abc: 'data' });

      useToolStore.setState({
        transformApiArgumentsToAiState: vi.fn().mockResolvedValue(toolResponse),
      });

      useChatStore.setState({
        internal_togglePluginApiCalling: vi.fn(),
        internal_updateMessageContent: vi.fn(),
        text2image: vi.fn(),
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Verify that the builtin tool was invoked with the correct arguments
      expect(useToolStore.getState().transformApiArgumentsToAiState).toHaveBeenCalledWith(
        payload.apiName,
        JSON.parse(payload.arguments),
      );

      // Verify that the message content was updated with the tool response
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        toolResponse,
      );

      // Verify that loading was toggled correctly
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenCalledTimes(2);

      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        1,
        true,
        messageId,
        expect.any(String),
      );
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        2,
        false,
        messageId,
        expect.any(String),
      );
      expect(useChatStore.getState().text2image).toHaveBeenCalled();
    });

    it('should invoke a builtin tool and update message content', async () => {
      const payload = {
        apiName: 'text2image',
        arguments: JSON.stringify({ key: 'value' }),
      } as ChatToolPayload;

      const messageId = 'message-id';
      const toolResponse = 'Builtin tool response';

      act(() => {
        useToolStore.setState({
          transformApiArgumentsToAiState: vi.fn().mockResolvedValue(toolResponse),
          text2image: vi.fn(),
        });

        useChatStore.setState({
          internal_togglePluginApiCalling: vi.fn(),
          text2image: vi.fn(),
          internal_updateMessageContent: vi.fn(),
        });
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Verify that the builtin tool was invoked with the correct arguments
      expect(useToolStore.getState().transformApiArgumentsToAiState).toHaveBeenCalledWith(
        payload.apiName,
        JSON.parse(payload.arguments),
      );

      // Verify that the message content was updated with the tool response
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenCalledTimes(2);
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        toolResponse,
      );

      // Verify that loading was toggled correctly
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        1,
        true,
        messageId,
        expect.any(String),
      );
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        2,
        false,
        messageId,
        expect.any(String),
      );
      expect(useChatStore.getState().text2image).not.toHaveBeenCalled();
    });

    it('should handle errors when transformApiArgumentsToAiState throw error', async () => {
      const args = { key: 'value' };
      const payload = {
        apiName: 'builtinApi',
        arguments: JSON.stringify(args),
      } as ChatToolPayload;

      const messageId = 'message-id';

      useToolStore.setState({
        transformApiArgumentsToAiState: vi
          .fn()
          .mockRejectedValue({ error: 'transformApiArgumentsToAiState throw error' }),
      });

      useChatStore.setState({
        internal_togglePluginApiCalling: vi.fn(),
        internal_updateMessageContent: vi.fn(),
        internal_updatePluginError: vi.fn(),
        text2image: vi.fn(),
        refreshMessages: vi.fn(),
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      expect(result.current.internal_updatePluginError).toHaveBeenCalledWith('message-id', {
        type: 'PluginFailToTransformArguments',
        body: {
          message: expect.any(String),
          stack: undefined,
          arguments: args,
          schema: undefined,
        },
        message: expect.any(String),
      });
      // Verify that loading was toggled correctly
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        1,
        true,
        messageId,
        expect.any(String),
      );
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        2,
        false,
        messageId,
        expect.any(String),
      );

      // Verify that the message content was not updated
      expect(result.current.internal_updateMessageContent).not.toHaveBeenCalled();

      // Verify that messages were not refreshed
      expect(useChatStore.getState().text2image).not.toHaveBeenCalled();
    });
  });

  describe('invokeMarkdownTypePlugin', () => {
    it('should invoke a markdown type plugin', async () => {
      const payload = {
        apiName: 'markdownApi',
        identifier: 'abc',
        type: 'markdown',
        arguments: JSON.stringify({ key: 'value' }),
      } as ChatToolPayload;
      const messageId = 'message-id';

      const runPluginApiMock = vi.fn();

      act(() => {
        useChatStore.setState({ internal_callPluginApi: runPluginApiMock });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeMarkdownTypePlugin(messageId, payload);
      });

      // Verify that the markdown type plugin was invoked
      expect(runPluginApiMock).toHaveBeenCalledWith(messageId, payload);
    });
  });

  describe('invokeStandaloneTypePlugin', () => {
    it('should update message with error and refresh messages if plugin settings are invalid', async () => {
      const messageId = 'message-id';

      const payload = {
        identifier: 'pluginName',
      } as ChatToolPayload;

      act(() => {
        useToolStore.setState({
          validatePluginSettings: vi
            .fn()
            .mockResolvedValue({ valid: false, errors: ['Invalid setting'] }),
        });

        useChatStore.setState({ refreshMessages: vi.fn(), invokeStandaloneTypePlugin });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeStandaloneTypePlugin(messageId, payload);
      });

      const call = vi.mocked(messageService.updateMessageError).mock.calls[0];

      expect(call[1]).toEqual({
        body: {
          error: ['Invalid setting'],
          message: '[plugin] your settings is invalid with plugin manifest setting schema',
        },
        message: undefined,
        type: 'PluginSettingsInvalid',
      });

      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('reInvokeToolMessage', () => {
    it('should re-invoke a tool message', async () => {
      const messageId = 'message-id';
      const message = {
        id: messageId,
        role: 'tool',
        content: 'Original content',
        plugin: {
          type: 'default',
          identifier: 'plugin-id',
          apiName: 'api-name',
          arguments: '{}',
        },
        tool_call_id: 'tool-id',
      } as UIChatMessage;

      const internal_invokeDifferentTypePluginMock = vi.fn();
      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          messagesMap: { [messageMapKey('session-id')]: [message] },
          internal_invokeDifferentTypePlugin: internal_invokeDifferentTypePluginMock,
          internal_updateMessageError: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.reInvokeToolMessage(messageId);
      });

      expect(internal_invokeDifferentTypePluginMock).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining(message.plugin),
      );
    });

    it('should clear error content when re-invoking', async () => {
      const messageId = 'message-id';
      const message = {
        id: messageId,
        role: 'tool',
        content: 'Original content',
        plugin: {
          type: 'default',
          identifier: 'plugin-id',
          apiName: 'api-name',
          arguments: '{}',
        },
        tool_call_id: 'tool-id',
        pluginError: { message: 'Previous error', type: 'ProviderBizError' },
      } as UIChatMessage;

      const internal_updateMessageErrorMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          messagesMap: { [messageMapKey('session-id')]: [message] },
          internal_invokeDifferentTypePlugin: vi.fn(),
          internal_updateMessagePluginError: internal_updateMessageErrorMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.reInvokeToolMessage(messageId);
      });

      expect(internal_updateMessageErrorMock).toHaveBeenCalledWith(messageId, null);
    });
  });

  describe('updatePluginArguments', () => {
    it('should update plugin arguments and refresh messages', async () => {
      const messageId = 'message-id';
      const toolCallId = 'tool-call-id';
      const parentId = 'parent-id';
      const identifier = 'plugin';
      const newArguments = { newKey: 'newValue' };

      const toolMessage = {
        id: messageId,
        role: 'tool',
        content: 'Tool content',
        plugin: { identifier: identifier, arguments: '{"oldKey":"oldValue"}' },
        tool_call_id: toolCallId,
        parentId,
      } as UIChatMessage;

      const assistantMessage = {
        id: parentId,
        role: 'assistant',
        content: 'Assistant content',
        tools: [{ identifier: identifier, arguments: '{"oldKey":"oldValue"}', id: toolCallId }],
      } as UIChatMessage;

      act(() => {
        useChatStore.setState({
          activeId: 'anbccfdd',
          messagesMap: { [messageMapKey('anbccfdd')]: [assistantMessage, toolMessage] },
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.updatePluginArguments(messageId, newArguments);
      });

      expect(messageService.updateMessagePluginArguments).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining(newArguments),
      );
      // TODO: 需要验证 updateMessage 是否被调用
      // expect(messageService.updateMessage).toHaveBeenCalledWith(
      //   parentId,
      //   expect.objectContaining({ tools: expect.any(Array) }),
      // );
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('internal_callPluginApi', () => {
    it('should call plugin API and update message content', async () => {
      const messageId = 'message-id';
      const payload: ChatToolPayload = {
        id: 'tool-id',
        type: 'default',
        identifier: 'plugin-id',
        apiName: 'api-name',
        arguments: '{}',
      };
      const apiResponse = 'API response';

      vi.spyOn(chatService, 'runPluginApi').mockResolvedValue({
        text: apiResponse,
        traceId: 'trace-id',
      });

      act(() => {
        useChatStore.setState({
          internal_togglePluginApiCalling: vi.fn(),
          internal_updateMessageContent: vi.fn(),
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_callPluginApi(messageId, payload);
      });

      expect(chatService.runPluginApi).toHaveBeenCalledWith(payload, expect.any(Object));
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        apiResponse,
      );
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { traceId: 'trace-id' });
    });

    it('should handle API call errors', async () => {
      const messageId = 'message-id';
      const payload: ChatToolPayload = {
        id: 'tool-id',
        type: 'default',
        identifier: 'plugin-id',
        apiName: 'api-name',
        arguments: '{}',
      };
      const error = new Error('API call failed');

      vi.spyOn(chatService, 'runPluginApi').mockRejectedValue(error);

      act(() => {
        useChatStore.setState({
          internal_togglePluginApiCalling: vi.fn(),
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_callPluginApi(messageId, payload);
      });

      expect(messageService.updateMessageError).toHaveBeenCalledWith(messageId, error);
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('internal_transformToolCalls', () => {
    it('should transform tool calls correctly', () => {
      const toolCalls: MessageToolCall[] = [
        {
          id: 'tool1',
          function: {
            name: ['plugin1', 'api1', 'default'].join(PLUGIN_SCHEMA_SEPARATOR),
            arguments: '{}',
          },
          type: 'function',
        },
        {
          id: 'tool2',
          function: {
            name: ['plugin2', 'api2', 'markdown'].join(PLUGIN_SCHEMA_SEPARATOR),
            arguments: '{}',
          },
          type: 'function',
        },
      ];

      const { result } = renderHook(() => useChatStore());

      const transformed = result.current.internal_transformToolCalls(toolCalls);

      expect(transformed).toEqual([
        {
          id: 'tool1',
          identifier: 'plugin1',
          apiName: 'api1',
          type: 'default',
          arguments: '{}',
        },
        {
          id: 'tool2',
          identifier: 'plugin2',
          apiName: 'api2',
          type: 'markdown',
          arguments: '{}',
        },
      ]);
    });

    it('should handle MD5 hashed API names', () => {
      const apiName = 'testApi';
      const resolver = new ToolNameResolver();
      // Generate a very long name to force MD5 hashing
      const longApiName =
        'very-long-action-name-that-will-cause-the-total-length-to-exceed-64-characters';
      const toolName = resolver.generate('plugin1', longApiName, 'default');

      // Extract the MD5 part from the generated name
      const parts = toolName.split(PLUGIN_SCHEMA_SEPARATOR);
      const md5Hash = parts[1].replace(PLUGIN_SCHEMA_API_MD5_PREFIX, '');

      const toolCalls: MessageToolCall[] = [
        {
          id: 'tool1',
          function: {
            name: ['plugin1', PLUGIN_SCHEMA_API_MD5_PREFIX + md5Hash, 'default'].join(
              PLUGIN_SCHEMA_SEPARATOR,
            ),
            arguments: '{}',
          },
          type: 'function',
        },
      ];

      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              type: 'plugin',
              identifier: 'plugin1',
              manifest: {
                identifier: 'plugin1',
                api: [
                  {
                    name: longApiName,
                    parameters: { type: 'object', properties: {} },
                    description: 'abc',
                  },
                ],
                type: 'default',
              } as any,
            },
          ],
        });
      });

      const { result } = renderHook(() => useChatStore());

      const transformed = result.current.internal_transformToolCalls(toolCalls);

      expect(transformed[0].apiName).toBe(longApiName);
    });
  });

  describe('internal_updatePluginError', () => {
    it('should update plugin error and refresh messages', async () => {
      const messageId = 'message-id';
      const error = { message: 'Plugin error' } as any;

      act(() => {
        useChatStore.setState({
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_updatePluginError(messageId, error);
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { error });
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('internal_addToolToAssistantMessage', () => {
    it('should add too to assistant messages', async () => {
      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const toolCallId = 'tool-call-id';
      const identifier = 'plugin';

      const refreshToUpdateMessageToolsSpy = vi.spyOn(
        result.current,
        'internal_refreshToUpdateMessageTools',
      );

      const assistantMessage = {
        id: messageId,
        role: 'assistant',
        content: 'Assistant content',
        tools: [{ identifier: identifier, arguments: '{"oldKey":"oldValue"}', id: toolCallId }],
      } as UIChatMessage;

      act(() => {
        useChatStore.setState({
          activeId: 'anbccfdd',
          messagesMap: { [messageMapKey('anbccfdd')]: [assistantMessage] },
          refreshMessages: vi.fn(),
        });
      });

      await act(async () => {
        await result.current.internal_addToolToAssistantMessage(messageId, {
          identifier,
          arguments: '{"oldKey":"oldValue"}',
          id: 'newId',
          apiName: 'test',
          type: 'default',
        });
      });

      expect(refreshToUpdateMessageToolsSpy).toHaveBeenCalledWith(messageId);
    });
  });
});
