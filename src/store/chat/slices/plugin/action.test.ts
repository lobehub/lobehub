import { PLUGIN_SCHEMA_API_MD5_PREFIX, PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const';
import { ToolNameResolver } from '@lobechat/context-engine';
import { type ChatToolPayload, type MessageToolCall, type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import i18n from 'i18next';
import { type Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    createMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
    updateMessagePluginArguments: vi.fn(),
    updateMessagePluginState: vi.fn(),
    updateToolMessage: vi.fn(),
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

      const internal_execAgentRuntimeMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [toolMessage] },
          internal_execAgentRuntime: internal_execAgentRuntimeMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.summaryPluginContent(messageId);
      });

      expect(internal_execAgentRuntimeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: 'session-id',
          }),
          messages: [
            {
              role: 'assistant',
              content: i18n.t('prompts.summaryExpert', { ns: 'chat' }),
            },
            expect.objectContaining({
              id: toolMessage.id,
              content: toolMessage.content,
              role: 'assistant',
            }),
          ],
          parentMessageId: messageId,
          parentMessageType: 'assistant',
        }),
      );
    });

    it('should not summarize non-tool messages', async () => {
      const messageId = 'message-id';
      const nonToolMessage = {
        id: messageId,
        role: 'user',
        content: 'User message',
      } as UIChatMessage;

      const internal_execAgentRuntimeMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [nonToolMessage] },
          internal_execAgentRuntime: internal_execAgentRuntimeMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.summaryPluginContent(messageId);
      });

      expect(internal_execAgentRuntimeMock).not.toHaveBeenCalled();
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
        internal_execAgentRuntime: vi.fn(),
        refreshMessages: vi.fn(),
        optimisticUpdateMessageContent: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.fillPluginMessageContent(messageId, newContent, true);
      });

      // 验证 optimisticUpdateMessageContent 是否被正确调用
      // The function now takes 4 args: (id, content, extra?, context?)
      expect(result.current.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        messageId,
        newContent,
        undefined,
        undefined,
      );

      // 验证 coreProcessMessage 是否被正确调用
      expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: mockCurrentChats,
          parentMessageId: messageId,
          parentMessageType: 'user',
        }),
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
        internal_execAgentRuntime: vi.fn(),
        refreshMessages: vi.fn(),
        optimisticUpdateMessageContent: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.fillPluginMessageContent(messageId, newContent);
      });

      // 验证 optimisticUpdateMessageContent 是否被正确调用
      // The function now takes 4 args: (id, content, extra?, context?)
      expect(result.current.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        messageId,
        newContent,
        undefined,
        undefined,
      );

      // 验证 coreProcessMessage 没有被正确调用
      expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
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
      vi.spyOn(storeState, 'optimisticUpdateMessageContent').mockResolvedValue();

      const runSpy = vi.spyOn(chatService, 'runPluginApi').mockResolvedValue({
        text: pluginApiResponse,
        traceId: '',
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeDefaultTypePlugin(messageId, pluginPayload);
      });

      expect(runSpy).toHaveBeenCalledWith(pluginPayload, { signal: undefined, trace: {} });
      expect(storeState.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        messageId,
        pluginApiResponse,
        undefined,
        undefined,
      );
    });

    it('should handle errors when the plugin API call fails', async () => {
      const pluginPayload = { apiName: 'testApi', arguments: { key: 'value' } };
      const messageId = 'message-id';
      const error = new Error('API call failed');
      const mockMessages = [{ id: 'msg-1', content: 'test' }] as any;

      // Mock the service to return messages
      (messageService.updateMessageError as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const storeState = useChatStore.getState();
      const replaceMessagesSpy = vi.spyOn(storeState, 'replaceMessages');
      vi.spyOn(storeState, 'triggerAIMessage').mockResolvedValue(undefined);

      vi.spyOn(chatService, 'runPluginApi').mockRejectedValue(error);

      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        await result.current.invokeDefaultTypePlugin(messageId, pluginPayload);
      });

      expect(chatService.runPluginApi).toHaveBeenCalledWith(pluginPayload, { trace: {} });
      // Context now includes groupId from the message
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        messageId,
        error,
        expect.objectContaining({ topicId: undefined }),
      );
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: expect.objectContaining({ topicId: undefined }),
      });
      expect(storeState.triggerAIMessage).not.toHaveBeenCalled(); // 确保在错误情况下不调用此方法
    });
  });

  describe('updatePluginState', () => {
    it('should update the plugin state for a message', async () => {
      const messageId = 'message-id';
      const pluginStateValue = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }] as any;

      // Mock the service to return messages
      (messageService.updateMessagePluginState as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.fn();
      const initialState = {
        activeAgentId: 'inbox',
        replaceMessages: replaceMessagesSpy,
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.optimisticUpdatePluginState(messageId, pluginStateValue);
      });

      expect(messageService.updateMessagePluginState).toHaveBeenCalledWith(
        messageId,
        pluginStateValue,
        {
          agentId: 'inbox',
          topicId: null,
        },
      );

      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'inbox', topicId: null, threadId: undefined },
      });
    });
  });

  describe('createAssistantMessageByPlugin', () => {
    it('should create an assistant message and replace messages', async () => {
      const mockMessages = [{ id: 'msg-1', content: 'test' }] as any;
      // 模拟 messageService.createMessage 方法的实现
      (messageService.createMessage as Mock).mockResolvedValue({
        id: 'new-message-id',
        messages: mockMessages,
      });

      // 设置初始状态并模拟 replaceMessages 方法
      const initialState = {
        replaceMessages: vi.fn(),
        activeAgentId: 'session-id',
        activeTopicId: 'topic-id',
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const content = 'Test content';
      const parentId = 'parent-message-id';

      await act(async () => {
        await result.current.createAssistantMessageByPlugin(content, parentId);
      });

      // 验证 messageService.createMessage 是否被带有正确参数调用
      expect(messageService.createMessage).toHaveBeenCalledWith({
        agentId: initialState.activeAgentId,
        content,
        parentId,
        role: 'assistant',
        topicId: initialState.activeTopicId,
      });

      // 验证 replaceMessages 是否被调用
      expect(result.current.replaceMessages).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'session-id', topicId: 'topic-id' },
      });
    });

    it('should handle errors when message creation fails', async () => {
      // 模拟 messageService.create 方法，使其抛出错误
      const errorMessage = 'Failed to create message';
      (messageService.createMessage as Mock).mockRejectedValue(new Error(errorMessage));

      // 设置初始状态并模拟 refreshMessages 方法
      const initialState = {
        refreshMessages: vi.fn(),
        activeAgentId: 'session-id',
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
        agentId: initialState.activeAgentId,
        content,
        parentId,
        role: 'assistant',
        topicId: initialState.activeTopicId,
      });

      // 验证 refreshMessages 是否没有被调用
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('invokeBuiltinTool', () => {
    it('should invoke Tool Store executor with parsed arguments', async () => {
      const payload = {
        identifier: 'test-tool',
        apiName: 'mockBuiltinAction',
        arguments: JSON.stringify({ input: 'test', value: 123 }),
      } as ChatToolPayload;

      const messageId = 'message-id';
      const mockInvokeBuiltinTool = vi.fn().mockResolvedValue({
        content: 'result',
        success: true,
      });

      // Mock hasExecutor to return true
      const hasExecutorModule = await import('@/store/tool/slices/builtin/executors');
      vi.spyOn(hasExecutorModule, 'hasExecutor').mockReturnValue(true);

      // Mock Tool Store's invokeBuiltinTool
      vi.spyOn(useToolStore.getState(), 'invokeBuiltinTool').mockImplementation(
        mockInvokeBuiltinTool,
      );

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Verify that Tool Store's invokeBuiltinTool was called with correct arguments
      expect(mockInvokeBuiltinTool).toHaveBeenCalledWith(
        'test-tool',
        'mockBuiltinAction',
        { input: 'test', value: 123 },
        expect.objectContaining({
          messageId,
        }),
      );
    });

    it('should not throw error if executor does not exist', async () => {
      const payload = {
        identifier: 'non-existent-tool',
        apiName: 'nonExistentAction',
        arguments: JSON.stringify({ key: 'value' }),
      } as ChatToolPayload;

      const messageId = 'message-id';

      // Mock hasExecutor to return false
      const hasExecutorModule = await import('@/store/tool/slices/builtin/executors');
      vi.spyOn(hasExecutorModule, 'hasExecutor').mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Should log error but not throw
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No executor found'));

      consoleErrorSpy.mockRestore();
    });

    it('should return error result if arguments cannot be parsed', async () => {
      const payload = {
        identifier: 'test-tool',
        apiName: 'mockBuiltinAction',
        arguments: 'invalid json',
      } as ChatToolPayload;

      const messageId = 'message-id';

      const { result } = renderHook(() => useChatStore());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Should return error result for invalid JSON
      expect(returnValue).toEqual({ error: 'Invalid arguments', success: false });
    });

    describe('registerAfterCompletion with Tool Store executor', () => {
      it('should create registerAfterCompletion when root execAgentRuntime operation exists', async () => {
        // Mock hasExecutor to return true
        const hasExecutorModule = await import('@/store/tool/slices/builtin/executors');
        vi.spyOn(hasExecutorModule, 'hasExecutor').mockReturnValue(true);

        // Setup: Create operation hierarchy
        // execAgentRuntime -> toolCalling -> executeToolCall
        const { result } = renderHook(() => useChatStore());

        let execAgentRuntimeOpId: string;
        let toolCallingOpId: string;
        let executeToolOpId: string;
        const messageId = 'tool-message-id';

        act(() => {
          // Create root operation
          execAgentRuntimeOpId = result.current.startOperation({
            type: 'execAgentRuntime',
            context: { agentId: 'session1' },
          }).operationId;

          // Create toolCalling child
          toolCallingOpId = result.current.startOperation({
            type: 'toolCalling',
            parentOperationId: execAgentRuntimeOpId,
          }).operationId;

          // Create executeToolCall grandchild
          executeToolOpId = result.current.startOperation({
            type: 'executeToolCall',
            context: { messageId },
            parentOperationId: toolCallingOpId,
          }).operationId;

          // Associate message with executeToolCall operation
          result.current.associateMessageWithOperation(messageId, executeToolOpId);
        });

        // Verify the operation hierarchy is set up correctly
        expect(result.current.operations[execAgentRuntimeOpId!].type).toBe('execAgentRuntime');
        expect(result.current.operations[toolCallingOpId!].parentOperationId).toBe(
          execAgentRuntimeOpId!,
        );
        expect(result.current.operations[executeToolOpId!].parentOperationId).toBe(
          toolCallingOpId!,
        );

        // Mock Tool Store's invokeBuiltinTool to capture the context
        let capturedContext: any;
        vi.spyOn(useToolStore.getState(), 'invokeBuiltinTool').mockImplementation(
          async (_id, _api, _params, ctx) => {
            capturedContext = ctx;
            return { success: true };
          },
        );

        const payload = {
          identifier: 'lobe-group-management',
          apiName: 'speak',
          arguments: JSON.stringify({ agentId: 'agent-1' }),
          type: 'builtin',
        } as ChatToolPayload;

        await act(async () => {
          await result.current.invokeBuiltinTool(messageId, payload);
        });

        // Verify registerAfterCompletion was passed to Tool Store
        expect(capturedContext).toBeDefined();
        expect(capturedContext.registerAfterCompletion).toBeDefined();
        expect(typeof capturedContext.registerAfterCompletion).toBe('function');

        // Call registerAfterCompletion and verify it registers to root operation
        const mockCallback = vi.fn();
        act(() => {
          capturedContext.registerAfterCompletion(mockCallback);
        });

        // The callback should be registered on the root execAgentRuntime operation
        const rootOp = result.current.operations[execAgentRuntimeOpId!];
        expect(rootOp).toBeDefined();
        expect(rootOp.metadata.runtimeHooks?.afterCompletionCallbacks).toHaveLength(1);
        expect(rootOp.metadata.runtimeHooks?.afterCompletionCallbacks?.[0]).toBe(mockCallback);
      });

      it('should not pass registerAfterCompletion when no root operation exists', async () => {
        // Mock hasExecutor to return true
        const hasExecutorModule = await import('@/store/tool/slices/builtin/executors');
        vi.spyOn(hasExecutorModule, 'hasExecutor').mockReturnValue(true);

        const { result } = renderHook(() => useChatStore());
        const messageId = 'tool-message-id';

        // No operations created - simulate standalone tool invocation

        // Mock Tool Store's invokeBuiltinTool to capture the context
        let capturedContext: any;
        vi.spyOn(useToolStore.getState(), 'invokeBuiltinTool').mockImplementation(
          async (_id, _api, _params, ctx) => {
            capturedContext = ctx;
            return { success: true };
          },
        );

        const payload = {
          identifier: 'lobe-group-management',
          apiName: 'speak',
          arguments: JSON.stringify({ agentId: 'agent-1' }),
          type: 'builtin',
        } as ChatToolPayload;

        await act(async () => {
          await result.current.invokeBuiltinTool(messageId, payload);
        });

        // registerAfterCompletion should be undefined when no operation context
        expect(capturedContext).toBeDefined();
        expect(capturedContext.registerAfterCompletion).toBeUndefined();
      });

      it('should find root operation through multiple levels of hierarchy', async () => {
        // Mock hasExecutor to return true
        const hasExecutorModule = await import('@/store/tool/slices/builtin/executors');
        vi.spyOn(hasExecutorModule, 'hasExecutor').mockReturnValue(true);

        const { result } = renderHook(() => useChatStore());

        let execAgentRuntimeOpId: string;
        let level1OpId: string;
        let level2OpId: string;
        let level3OpId: string;
        const messageId = 'deep-tool-message-id';

        act(() => {
          // Create deep hierarchy: execAgentRuntime -> level1 -> level2 -> level3
          execAgentRuntimeOpId = result.current.startOperation({
            type: 'execAgentRuntime',
            context: { agentId: 'session1' },
          }).operationId;

          level1OpId = result.current.startOperation({
            type: 'callLLM',
            parentOperationId: execAgentRuntimeOpId,
          }).operationId;

          level2OpId = result.current.startOperation({
            type: 'toolCalling',
            parentOperationId: level1OpId,
          }).operationId;

          level3OpId = result.current.startOperation({
            type: 'executeToolCall',
            context: { messageId },
            parentOperationId: level2OpId,
          }).operationId;

          result.current.associateMessageWithOperation(messageId, level3OpId);
        });

        let capturedContext: any;
        vi.spyOn(useToolStore.getState(), 'invokeBuiltinTool').mockImplementation(
          async (_id, _api, _params, ctx) => {
            capturedContext = ctx;
            return { success: true };
          },
        );

        const payload = {
          identifier: 'lobe-group-management',
          apiName: 'speak',
          arguments: JSON.stringify({ agentId: 'agent-1' }),
          type: 'builtin',
        } as ChatToolPayload;

        await act(async () => {
          await result.current.invokeBuiltinTool(messageId, payload);
        });

        // Should still find the root operation
        expect(capturedContext.registerAfterCompletion).toBeDefined();

        const mockCallback = vi.fn();
        act(() => {
          capturedContext.registerAfterCompletion(mockCallback);
        });

        // Callback should be on root execAgentRuntime, not any intermediate level
        expect(result.current.operations[execAgentRuntimeOpId!]).toBeDefined();
        expect(
          result.current.operations[execAgentRuntimeOpId!].metadata.runtimeHooks
            ?.afterCompletionCallbacks,
        ).toHaveLength(1);
        expect(
          result.current.operations[level1OpId!].metadata.runtimeHooks?.afterCompletionCallbacks,
        ).toBeUndefined();
        expect(
          result.current.operations[level2OpId!].metadata.runtimeHooks?.afterCompletionCallbacks,
        ).toBeUndefined();
        expect(
          result.current.operations[level3OpId!].metadata.runtimeHooks?.afterCompletionCallbacks,
        ).toBeUndefined();
      });
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
      const mockMessages = [{ id: 'msg-1', content: 'test' }] as any;

      const payload = {
        identifier: 'pluginName',
      } as ChatToolPayload;

      // Mock the service to return messages
      (messageService.updateMessageError as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.fn();

      act(() => {
        useToolStore.setState({
          validatePluginSettings: vi
            .fn()
            .mockResolvedValue({ valid: false, errors: ['Invalid setting'] }),
        });

        useChatStore.setState({ replaceMessages: replaceMessagesSpy, invokeStandaloneTypePlugin });
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
        message: 'response.PluginSettingsInvalid',
        type: 'PluginSettingsInvalid',
      });

      // Context now includes groupId from the message
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: expect.objectContaining({ topicId: undefined }),
      });
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
          activeAgentId: 'session-id',
          messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [message] },
          internal_invokeDifferentTypePlugin: internal_invokeDifferentTypePluginMock,
          optimisticUpdateMessagePluginError: vi.fn(),
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
          activeAgentId: 'session-id',
          messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [message] },
          internal_invokeDifferentTypePlugin: vi.fn(),
          optimisticUpdateMessagePluginError: internal_updateMessageErrorMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.reInvokeToolMessage(messageId);
      });

      expect(internal_updateMessageErrorMock).toHaveBeenCalledWith(messageId, null, undefined);
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
          activeAgentId: 'anbccfdd',
          messagesMap: {
            [messageMapKey({ agentId: 'anbccfdd' })]: [assistantMessage, toolMessage],
          },
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.optimisticUpdatePluginArguments(messageId, newArguments);
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
          optimisticUpdateMessageContent: vi.fn(),
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_callPluginApi(messageId, payload);
      });

      expect(chatService.runPluginApi).toHaveBeenCalledWith(payload, expect.any(Object));
      expect(result.current.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        messageId,
        apiResponse,
        undefined,
        undefined,
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
      const mockMessages = [{ id: 'msg-1', content: 'test' }] as any;

      // Mock the service to return messages
      (messageService.updateMessageError as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      vi.spyOn(chatService, 'runPluginApi').mockRejectedValue(error);

      const replaceMessagesSpy = vi.fn();

      act(() => {
        useChatStore.setState({
          replaceMessages: replaceMessagesSpy,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_callPluginApi(messageId, payload);
      });

      // Context now includes groupId from the message
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        messageId,
        error,
        expect.objectContaining({ topicId: undefined }),
      );
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: expect.objectContaining({ topicId: undefined }),
      });
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

    it('should repair malformed JSON arguments with escaped string issue', () => {
      // This is the malformed data from haiku-4.5 model
      // The entire JSON got stuffed into the "description" field with escaped quotes
      const malformedArguments = JSON.stringify({
        description:
          'Synthesize all 10 batch analyses into 10 most important themes for product builders", "instruction": "You have access to 10 batch analysis files", "runInClient": true, "timeout": 120000}',
      });

      const toolCalls: MessageToolCall[] = [
        {
          id: 'tool1',
          function: {
            name: ['lobe-gtd', 'execTask', 'default'].join(PLUGIN_SCHEMA_SEPARATOR),
            arguments: malformedArguments,
          },
          type: 'function',
        },
      ];

      // Setup builtin tool manifest with schema that has required fields
      act(() => {
        useToolStore.setState({
          builtinTools: [
            {
              type: 'builtin',
              identifier: 'lobe-gtd',
              manifest: {
                identifier: 'lobe-gtd',
                api: [
                  {
                    name: 'execTask',
                    description: 'Execute async task',
                    parameters: {
                      type: 'object',
                      required: ['description', 'instruction'],
                      properties: {
                        description: { type: 'string' },
                        instruction: { type: 'string' },
                        runInClient: { type: 'boolean' },
                        timeout: { type: 'number' },
                      },
                    },
                  },
                ],
                type: 'builtin',
              } as any,
            },
          ],
        });
      });

      const { result } = renderHook(() => useChatStore());

      const transformed = result.current.internal_transformToolCalls(toolCalls);

      // Parse the transformed arguments
      const repairedArgs = JSON.parse(transformed[0].arguments);

      // Verify all fields are correctly extracted
      expect(repairedArgs).toHaveProperty('description');
      expect(repairedArgs).toHaveProperty('instruction');
      expect(repairedArgs).toHaveProperty('runInClient', true);
      expect(repairedArgs).toHaveProperty('timeout', 120000);

      // Verify description is the correct short value, not the entire malformed string
      expect(repairedArgs.description).toBe(
        'Synthesize all 10 batch analyses into 10 most important themes for product builders',
      );
      expect(repairedArgs.instruction).toBe('You have access to 10 batch analysis files');
    });
  });

  describe('internal_updatePluginError', () => {
    it('should update plugin error and refresh messages', async () => {
      const messageId = 'message-id';
      const error = { message: 'Plugin error' } as any;
      const mockMessages = [{ id: 'msg-1', content: 'test' }] as any;

      // Mock the service to return messages
      (messageService.updateMessage as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.fn();

      act(() => {
        useChatStore.setState({
          activeAgentId: 'inbox',
          replaceMessages: replaceMessagesSpy,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.optimisticUpdatePluginError(messageId, error);
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        messageId,
        { error },
        { agentId: 'inbox', topicId: null },
      );
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'inbox', topicId: null, threadId: undefined },
      });
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
          activeAgentId: 'anbccfdd',
          messagesMap: { [messageMapKey({ agentId: 'anbccfdd' })]: [assistantMessage] },
          refreshMessages: vi.fn(),
        });
      });

      await act(async () => {
        await result.current.optimisticAddToolToAssistantMessage(messageId, {
          identifier,
          arguments: '{"oldKey":"oldValue"}',
          id: 'newId',
          apiName: 'test',
          type: 'default',
        });
      });

      expect(refreshToUpdateMessageToolsSpy).toHaveBeenCalledWith(messageId, undefined);
    });
  });

  describe('Plugin OptimisticUpdateContext isolation', () => {
    describe('optimisticUpdatePluginState', () => {
      it('should use context sessionId/topicId when provided', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const pluginState = { key: 'value' };
        const contextSessionId = 'context-session';
        const contextTopicId = 'context-topic';

        (messageService.updateMessagePluginState as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

        let operationId: string;
        await act(async () => {
          // Create operation with desired context
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: { agentId: contextSessionId, topicId: contextTopicId },
          });
          operationId = op.operationId;

          await result.current.optimisticUpdatePluginState(messageId, pluginState, {
            operationId,
          });
        });

        expect(messageService.updateMessagePluginState).toHaveBeenCalledWith(
          messageId,
          pluginState,
          { agentId: contextSessionId, topicId: contextTopicId },
        );
        expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
          context: { agentId: contextSessionId, topicId: contextTopicId, threadId: undefined },
        });
      });

      it('should fallback to activeAgentId/activeTopicId when context not provided', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const pluginState = { key: 'value' };

        act(() => {
          useChatStore.setState({
            activeAgentId: 'active-session',
            activeTopicId: 'active-topic',
          });
        });

        (messageService.updateMessagePluginState as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        await act(async () => {
          await result.current.optimisticUpdatePluginState(messageId, pluginState);
        });

        expect(messageService.updateMessagePluginState).toHaveBeenCalledWith(
          messageId,
          pluginState,
          { agentId: 'active-session', topicId: 'active-topic' },
        );
      });
    });

    describe('optimisticUpdatePluginError', () => {
      it('should use context sessionId/topicId when provided', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const error = { message: 'Plugin error', type: 'error' as any };
        const contextSessionId = 'context-session';
        const contextTopicId = 'context-topic';

        (messageService.updateMessage as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        let operationId: string;
        await act(async () => {
          // Create operation with desired context
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: { agentId: contextSessionId, topicId: contextTopicId },
          });
          operationId = op.operationId;

          await result.current.optimisticUpdatePluginError(messageId, error, {
            operationId,
          });
        });

        expect(messageService.updateMessage).toHaveBeenCalledWith(
          messageId,
          { error },
          { agentId: contextSessionId, topicId: contextTopicId },
        );
      });
    });

    describe('internal_refreshToUpdateMessageTools', () => {
      it('should use context sessionId/topicId when provided', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const contextSessionId = 'context-session';
        const contextTopicId = 'context-topic';

        const message = {
          id: messageId,
          role: 'assistant',
          content: 'test',
          tools: [{ id: 'tool-1', identifier: 'test', apiName: 'test', arguments: '{}' }],
          sessionId: contextSessionId,
          topicId: contextTopicId,
        } as any;

        // Set up both dbMessagesMap and messagesMap
        const key = messageMapKey({ agentId: contextSessionId, topicId: contextTopicId });
        let operationId: string;
        act(() => {
          // Create operation with desired context
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: { agentId: contextSessionId, topicId: contextTopicId },
          });
          operationId = op.operationId;

          useChatStore.setState({
            dbMessagesMap: {
              [key]: [message],
            },
            messagesMap: {
              [key]: [message],
            },
            activeAgentId: contextSessionId,
            activeTopicId: contextTopicId,
          });
        });

        await act(async () => {
          await result.current.internal_refreshToUpdateMessageTools(messageId, {
            operationId,
          });
        });

        expect(messageService.updateMessage).toHaveBeenCalledWith(
          messageId,
          { tools: message.tools },
          { agentId: contextSessionId, topicId: contextTopicId },
        );
      });
    });

    describe('groupId context support', () => {
      const groupContext = {
        agentId: 'agent-in-group',
        groupId: 'group-123',
        topicId: 'topic-in-group',
      };

      it('optimisticUpdatePluginState should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const pluginState = { key: 'value' };

        (messageService.updateMessagePluginState as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        let operationId: string;
        await act(async () => {
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: groupContext,
          });
          operationId = op.operationId;

          await result.current.optimisticUpdatePluginState(messageId, pluginState, {
            operationId,
          });
        });

        expect(messageService.updateMessagePluginState).toHaveBeenCalledWith(
          messageId,
          pluginState,
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });

      it('optimisticUpdatePluginError should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const error = { message: 'Plugin error', type: 'error' as any };

        (messageService.updateMessage as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        let operationId: string;
        await act(async () => {
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: groupContext,
          });
          operationId = op.operationId;

          await result.current.optimisticUpdatePluginError(messageId, error, {
            operationId,
          });
        });

        expect(messageService.updateMessage).toHaveBeenCalledWith(
          messageId,
          { error },
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });

      it('internal_refreshToUpdateMessageTools should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';

        const message = {
          id: messageId,
          role: 'assistant',
          content: 'test',
          tools: [{ id: 'tool-1', identifier: 'test', apiName: 'test', arguments: '{}' }],
        } as any;

        const key = messageMapKey(groupContext);
        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: groupContext,
          });
          operationId = op.operationId;

          useChatStore.setState({
            dbMessagesMap: { [key]: [message] },
            messagesMap: { [key]: [message] },
            activeAgentId: groupContext.agentId,
            activeGroupId: groupContext.groupId,
            activeTopicId: groupContext.topicId,
          });
        });

        (messageService.updateMessage as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        await act(async () => {
          await result.current.internal_refreshToUpdateMessageTools(messageId, {
            operationId,
          });
        });

        expect(messageService.updateMessage).toHaveBeenCalledWith(
          messageId,
          { tools: message.tools },
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });

      it('optimisticUpdateToolMessage should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const content = 'new content';
        const pluginState = { status: 'success' };

        (messageService.updateToolMessage as Mock).mockResolvedValue({
          success: true,
          messages: [],
        });

        let operationId: string;
        await act(async () => {
          const op = result.current.startOperation({
            type: 'sendMessage',
            context: groupContext,
          });
          operationId = op.operationId;

          await result.current.optimisticUpdateToolMessage(
            messageId,
            { content, pluginState },
            { operationId },
          );
        });

        // Now uses single updateToolMessage call instead of multiple parallel calls
        expect(messageService.updateToolMessage).toHaveBeenCalledWith(
          messageId,
          { content, metadata: undefined, pluginError: undefined, pluginState },
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });
    });
  });

  describe('Plugin invoke functions use optimisticUpdateToolMessage', () => {
    const messageId = 'message-id';
    const payload: ChatToolPayload = {
      apiName: 'test-api',
      arguments: '{}',
      id: 'tool-call-id',
      identifier: 'test-plugin',
      type: 'default',
    };

    describe('invokeMCPTypePlugin', () => {
      it('should use optimisticUpdateToolMessage for successful result', async () => {
        const mockResult = {
          content: 'mcp result content',
          state: { content: [], isError: false },
          success: true,
        };

        // Mock the mcpService
        const mcpService = await import('@/services/mcp');
        vi.spyOn(mcpService.mcpService, 'invokeMcpToolCall').mockResolvedValue(mockResult);

        const optimisticUpdateToolMessageMock = vi.fn().mockResolvedValue(undefined);

        act(() => {
          useChatStore.setState({
            activeAgentId: 'session-id',
            messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [] },
            optimisticUpdateToolMessage: optimisticUpdateToolMessageMock,
            replaceMessages: vi.fn(),
            messageOperationMap: {},
            operations: {},
          });
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.invokeMCPTypePlugin(messageId, payload);
        });

        expect(optimisticUpdateToolMessageMock).toHaveBeenCalledWith(
          messageId,
          {
            content: mockResult.content,
            pluginError: undefined,
            pluginState: mockResult.state,
          },
          undefined,
        );
      });

      it('should use optimisticUpdateToolMessage for error result', async () => {
        const mockResult = {
          content: 'error content',
          error: { message: 'test error' },
          state: { content: [], isError: true },
          success: false,
        };

        const mcpService = await import('@/services/mcp');
        vi.spyOn(mcpService.mcpService, 'invokeMcpToolCall').mockResolvedValue(mockResult);

        const optimisticUpdateToolMessageMock = vi.fn().mockResolvedValue(undefined);

        act(() => {
          useChatStore.setState({
            activeAgentId: 'session-id',
            messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [] },
            optimisticUpdateToolMessage: optimisticUpdateToolMessageMock,
            replaceMessages: vi.fn(),
            messageOperationMap: {},
            operations: {},
          });
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.invokeMCPTypePlugin(messageId, payload);
        });

        expect(optimisticUpdateToolMessageMock).toHaveBeenCalledWith(
          messageId,
          {
            content: mockResult.content,
            pluginError: mockResult.error,
            pluginState: undefined,
          },
          undefined,
        );
      });
    });

    describe('invokeKlavisTypePlugin', () => {
      it('should use optimisticUpdateToolMessage for successful result', async () => {
        const mockResult = {
          content: 'klavis result content',
          state: { data: 'test-data' },
          success: true,
        };

        // Mock useToolStore to return a server
        vi.spyOn(useToolStore, 'getState').mockReturnValue({
          servers: [{ identifier: 'test-plugin', serverUrl: 'http://test.com' }],
          callKlavisTool: vi.fn().mockResolvedValue({
            success: true,
            data: mockResult,
          }),
        } as any);

        const optimisticUpdateToolMessageMock = vi.fn().mockResolvedValue(undefined);

        act(() => {
          useChatStore.setState({
            activeAgentId: 'session-id',
            messagesMap: { [messageMapKey({ agentId: 'session-id' })]: [] },
            optimisticUpdateToolMessage: optimisticUpdateToolMessageMock,
            replaceMessages: vi.fn(),
            messageOperationMap: {},
            operations: {},
          });
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.invokeKlavisTypePlugin(messageId, payload);
        });

        expect(optimisticUpdateToolMessageMock).toHaveBeenCalledWith(
          messageId,
          {
            content: mockResult.content,
            pluginError: undefined,
            pluginState: mockResult.state,
          },
          undefined,
        );
      });
    });
  });
});
