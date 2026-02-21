import { type GeneralAgentCallToolResultPayload } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { type Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import { type OperationCancelContext } from '@/store/chat/slices/operation/types';

import { createAssistantMessage, createCallToolInstruction, createMockStore } from './fixtures';
import {
  createInitialState,
  createTestContext,
  executeWithMockContext,
  simulateOperationCancellation,
} from './helpers';

describe('call_tool executor', () => {
  describe('Basic Behavior', () => {
    it('should create tool message and execute tool successfully', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: 'test-topic' });

      const assistantMessage = createAssistantMessage({ groupId: 'group_123' });
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_call_1',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test query' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall, { parentMessageId: 'msg_parent' });
      const state = createInitialState({ operationId: 'test-session' });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'tool_result',
        id: 'tool_call_1',
        result: { error: null },
      });
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(1);
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledTimes(1);
    });

    it('should call internal_invokeDifferentTypePlugin with correct parameters', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_call_abc',
        identifier: 'lobe-web-browsing',
        apiName: 'craw',
        arguments: JSON.stringify({ url: 'https://example.com' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const createdMessage = await (mockStore.optimisticCreateMessage as Mock).mock.results[0]
        .value;
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledWith(
        createdMessage.id,
        toolCall,
        undefined, // stepContext is undefined when not provided
      );
    });

    it('should return correct result structure with tool_result event', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          data: 'search results',
          error: null,
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('tool_result');
      const toolResultEvent = result.events[0] as any;
      expect(toolResultEvent.result).toEqual({ data: 'search results', error: null });
    });
  });

  describe('Tool Message Creation', () => {
    it('should create tool message with correct structure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'sess_123', topicId: 'topic_456' });

      const assistantMessage = createAssistantMessage({ groupId: 'group_789' });
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_call_xyz',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'AI news' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall, {
        parentMessageId: 'msg_parent_123',
      });
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context: { ...context, agentId: 'sess_123', topicId: 'topic_456' },
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'sess_123',
          content: '',
          groupId: 'group_789',
          parentId: 'msg_parent_123',
          plugin: toolCall,
          role: 'tool',
          threadId: undefined,
          tool_call_id: 'tool_call_xyz',
          topicId: 'topic_456',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should use assistant message groupId for tool message', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage({ groupId: 'group_special' });
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group_special',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should use correct parentId from payload', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction({}, { parentMessageId: 'msg_custom_parent' });
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_custom_parent',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should preserve plugin payload details in tool message', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_complex',
        identifier: 'custom-plugin',
        apiName: 'complexApi',
        arguments: JSON.stringify({
          param1: 'value1',
          param2: { nested: 'value2' },
          param3: [1, 2, 3],
        }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          plugin: toolCall,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('Skip Create Tool Message Mode', () => {
    it('should reuse existing tool message when skipCreateToolMessage is true', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      const existingToolMessage = {
        id: 'msg_existing_tool',
        role: 'tool',
        content: '',
        pluginIntervention: { status: 'pending' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage, existingToolMessage as any];

      const instruction = createCallToolInstruction(
        {},
        {
          skipCreateToolMessage: true,
          parentMessageId: 'msg_existing_tool',
        },
      );
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledWith(
        'msg_existing_tool',
        expect.any(Object),
        undefined, // stepContext is undefined when not provided
      );
    });

    it('should still execute tool when skipping message creation', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          data: 'result',
          error: null,
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      const existingToolMessage = {
        id: 'msg_tool_reuse',
        role: 'tool',
        content: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage, existingToolMessage as any];

      const toolCall: ChatToolPayload = {
        id: 'tool_resume',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'resumed query' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall, {
        skipCreateToolMessage: true,
        parentMessageId: 'msg_tool_reuse',
      });
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('tool_result');
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledWith(
        'msg_tool_reuse',
        toolCall,
        undefined, // stepContext is undefined when not provided
      );
    });
  });

  describe('Operation Tree Management', () => {
    it('should create three-level operation tree', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.startOperation).toHaveBeenCalledTimes(3);

      // First: toolCalling operation
      expect(mockStore.startOperation).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'toolCalling',
          parentOperationId: context.operationId,
        }),
      );

      // Second: createToolMessage operation
      expect(mockStore.startOperation).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'createToolMessage',
        }),
      );

      // Third: executeToolCall operation
      expect(mockStore.startOperation).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          type: 'executeToolCall',
        }),
      );
    });

    it('should create toolCalling operation as parent', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'sess_op', topicId: 'topic_op' });

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_op_test',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context: { ...context, agentId: 'sess_op', topicId: 'topic_op' },
      });

      // Then
      expect(mockStore.startOperation).toHaveBeenNthCalledWith(1, {
        type: 'toolCalling',
        context: {
          agentId: 'sess_op',
          topicId: 'topic_op',
        },
        parentOperationId: context.operationId,
        metadata: expect.objectContaining({
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          tool_call_id: 'tool_op_test',
        }),
      });
    });

    it('should create createToolMessage operation as child of toolCalling', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'sess_child', topicId: 'topic_child' });

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_child_test',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context: { ...context, agentId: 'sess_child', topicId: 'topic_child' },
      });

      // Then
      const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value.operationId;

      expect(mockStore.startOperation).toHaveBeenNthCalledWith(2, {
        type: 'createToolMessage',
        context: {
          agentId: 'sess_child',
          topicId: 'topic_child',
        },
        parentOperationId: toolCallingOpId,
        metadata: expect.objectContaining({
          tool_call_id: 'tool_child_test',
        }),
      });
    });

    it('should create executeToolCall operation with messageId in context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value.operationId;
      const createdMessage = await (mockStore.optimisticCreateMessage as Mock).mock.results[0]
        .value;

      expect(mockStore.startOperation).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          type: 'executeToolCall',
          context: {
            messageId: createdMessage.id,
          },
          parentOperationId: toolCallingOpId,
        }),
      );
    });

    it('should complete all operations on success', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - completeOperation called 3 times: createToolMessage, executeToolCall, and toolCalling
      expect(mockStore.completeOperation).toHaveBeenCalledTimes(3);

      const createToolMsgOpId = (mockStore.startOperation as Mock).mock.results[1].value
        .operationId;
      const executeToolOpId = (mockStore.startOperation as Mock).mock.results[2].value.operationId;
      const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value.operationId;

      expect(mockStore.completeOperation).toHaveBeenCalledWith(createToolMsgOpId);
      expect(mockStore.completeOperation).toHaveBeenCalledWith(executeToolOpId);
      expect(mockStore.completeOperation).toHaveBeenCalledWith(toolCallingOpId);
    });

    it('should fail toolCalling operation on tool execution error', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          error: 'Tool execution failed',
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value.operationId;

      expect(mockStore.failOperation).toHaveBeenCalledWith(toolCallingOpId, {
        type: 'ToolExecutionError',
        message: 'Tool execution failed',
      });
    });
  });

  describe('CRITICAL: Parent Cancellation Check (Bug Fix Lines 395-406)', () => {
    it('should skip tool execution if parent operation cancelled after message creation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // Mock optimisticCreateMessage to cancel parent operation before returning
      mockStore.optimisticCreateMessage = vi.fn().mockImplementation(async (params) => {
        const message = { id: 'msg_test', ...params };

        // Cancel the toolCalling operation after message creation
        const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value
          .operationId;
        const toolCallingOp = mockStore.operations[toolCallingOpId];
        if (toolCallingOp) {
          simulateOperationCancellation(toolCallingOp, 'Parent cancelled during message creation');
        }

        return message;
      });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - tool execution should be skipped
      expect(mockStore.internal_invokeDifferentTypePlugin).not.toHaveBeenCalled();
      expect(result.events).toHaveLength(0);
      expect(result.newState).toEqual(state);
    });

    it('should check parent abortController signal after message creation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // Setup to abort parent operation during message creation
      mockStore.optimisticCreateMessage = vi.fn().mockImplementation(async (params) => {
        const message = { id: 'msg_abort_test', ...params };

        // Abort the parent toolCalling operation
        const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value
          .operationId;
        mockStore.operations[toolCallingOpId].abortController.abort();

        return message;
      });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value.operationId;
      const operation = mockStore.operations[toolCallingOpId];

      expect(operation.abortController.signal.aborted).toBe(true);
      expect(mockStore.internal_invokeDifferentTypePlugin).not.toHaveBeenCalled();
    });

    it('should return early without executing tool when parent cancelled', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState({ operationId: 'test-session', stepCount: 5 });

      // Cancel parent during message creation
      mockStore.optimisticCreateMessage = vi.fn().mockImplementation(async (params) => {
        const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value
          .operationId;
        simulateOperationCancellation(mockStore.operations[toolCallingOpId]);
        return { id: 'msg_early_return', ...params };
      });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(0);
      expect(result.newState).toEqual(state);
      expect(result.newState.stepCount).toBe(5); // Unchanged
    });

    it('should not create executeToolCall operation if parent cancelled', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // Cancel during message creation
      mockStore.optimisticCreateMessage = vi.fn().mockImplementation(async (params) => {
        const toolCallingOpId = (mockStore.startOperation as Mock).mock.results[0].value
          .operationId;
        mockStore.operations[toolCallingOpId].abortController.abort();
        return { id: 'msg_no_execute', ...params };
      });

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - only 2 operations created (toolCalling + createToolMessage), NOT executeToolCall
      expect(mockStore.startOperation).toHaveBeenCalledTimes(2);
      expect(mockStore.startOperation).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'executeToolCall' }),
      );
    });

    it('should proceed normally if parent not cancelled', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - normal execution
      expect(mockStore.startOperation).toHaveBeenCalledTimes(3);
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledTimes(1);
      expect(result.events).toHaveLength(1);
    });
  });

  describe('Cancel Handler Behavior', () => {
    it('should register cancel handler for createToolMessage operation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.onOperationCancel).toHaveBeenCalledTimes(2);

      const createToolMsgOpId = (mockStore.startOperation as Mock).mock.results[1].value
        .operationId;
      expect(mockStore.onOperationCancel).toHaveBeenCalledWith(
        createToolMsgOpId,
        expect.any(Function),
      );
    });

    it('should register cancel handler for executeToolCall operation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const executeToolOpId = (mockStore.startOperation as Mock).mock.results[2].value.operationId;
      expect(mockStore.onOperationCancel).toHaveBeenCalledWith(
        executeToolOpId,
        expect.any(Function),
      );
    });

    it('should update operation metadata with createMessagePromise', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const createToolMsgOpId = (mockStore.startOperation as Mock).mock.results[1].value
        .operationId;
      expect(mockStore.updateOperationMetadata).toHaveBeenCalledWith(
        createToolMsgOpId,
        expect.objectContaining({
          createMessagePromise: expect.any(Promise),
        }),
      );
    });
  });

  describe('Usage Tracking', () => {
    it('should accumulate tool usage with execution time', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_usage',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.usage.tools.totalCalls).toBe(1);
      expect(result.newState.usage.tools.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.newState.usage.tools.byTool).toHaveLength(1);
      expect(result.newState.usage.tools.byTool[0]).toMatchObject({
        name: 'lobe-web-browsing/search',
        calls: 1,
      });
    });

    it('should use TOOL_PRICING for search tool', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_pricing_search',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - TOOL_PRICING['lobe-web-browsing/search'] = 0.001
      expect(result.newState.cost?.total).toBeCloseTo(0.001, 5);
    });

    it('should use TOOL_PRICING for craw tool', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_pricing_craw',
        identifier: 'lobe-web-browsing',
        apiName: 'craw',
        arguments: JSON.stringify({ url: 'https://example.com' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - TOOL_PRICING['lobe-web-browsing/craw'] = 0.002
      expect(result.newState.cost?.total).toBeCloseTo(0.002, 5);
    });

    it('should use zero cost for unknown tools', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_unknown',
        identifier: 'custom-plugin',
        apiName: 'unknownApi',
        arguments: JSON.stringify({ param: 'value' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      if (result.newState.cost) {
        expect(result.newState.cost.total).toBe(0);
      }
    });

    it('should track successful tool execution in usage', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({ error: null }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const toolUsage = result.newState.usage.tools.byTool.find(
        (t) => t.name === 'lobe-web-browsing/search',
      );
      expect(toolUsage).toBeDefined();
      expect(toolUsage?.calls).toBe(1);
    });

    it('should track failed tool execution in usage', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({ error: 'Failed' }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const toolUsage = result.newState.usage.tools.byTool.find(
        (t) => t.name === 'lobe-web-browsing/search',
      );
      expect(toolUsage).toBeDefined();
      expect(toolUsage?.calls).toBe(1);
    });

    it('should include stepUsage in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_step_usage',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext?.stepUsage).toEqual({
        cost: 0.001,
        toolName: 'lobe-web-browsing/search',
        unitPrice: 0.001,
        usageCount: 1,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle message creation failure', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockResolvedValue(null),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('error');
      expect(result.newState).toEqual(state);
    });

    it('should fail createToolMessage operation on message creation error', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockResolvedValue(null),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_fail_create',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const createToolMsgOpId = (mockStore.startOperation as Mock).mock.results[1].value
        .operationId;
      expect(mockStore.failOperation).toHaveBeenCalledWith(createToolMsgOpId, {
        type: 'CreateMessageError',
        message: expect.stringContaining('Failed to create tool message'),
      });
    });

    it('should return error event on tool execution error', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          error: 'Network timeout',
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events[0]).toMatchObject({
        type: 'tool_result',
        result: { error: 'Network timeout' },
      });
    });

    it('should handle exception during execution', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockRejectedValue(new Error('Database error')),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('error');
      expect(result.newState).toEqual(state);
    });

    it('should return original state on error', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockRejectedValue(new Error('Tool crashed')),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState({ operationId: 'test-session', stepCount: 10 });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState).toEqual(state);
      expect(result.events[0].type).toBe('error');
    });
  });

  describe('State Management', () => {
    it('should update messages from dbMessagesMap', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      const updatedMessages = [
        assistantMessage,
        {
          id: 'msg_tool_updated',
          role: 'tool',
          content: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any,
      ];
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // Mock internal_invokeDifferentTypePlugin to update dbMessagesMap
      mockStore.internal_invokeDifferentTypePlugin = vi.fn().mockImplementation(async () => {
        mockStore.dbMessagesMap[context.messageKey] = updatedMessages;
        return { error: null };
      });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.messages).toEqual(updatedMessages);
    });

    it('should preserve other state fields', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState({
        operationId: 'preserve-session',
        stepCount: 15,
        status: 'running',
        lastModified: '2024-01-01T00:00:00.000Z',
      });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.operationId).toBe('preserve-session');
      expect(result.newState.stepCount).toBe(15);
      expect(result.newState.status).toBe('running');
      expect(result.newState.lastModified).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should not mutate original state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState({ operationId: 'immutable-test', stepCount: 5 });
      const originalState = JSON.parse(JSON.stringify(state));

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(state).toEqual(originalState);
    });
  });

  describe('Next Context', () => {
    it('should set phase to tool_result', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext?.phase).toBe('tool_result');
    });

    it('should include correct payload with tool data', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          data: 'search results',
          error: null,
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_context_test',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'AI news' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const createdMessage = await (mockStore.optimisticCreateMessage as Mock).mock.results[0]
        .value;
      const payload = result.nextContext?.payload as GeneralAgentCallToolResultPayload;
      expect(payload).toMatchObject({
        data: { data: 'search results', error: null },
        isSuccess: true,
        toolCall: toolCall,
        toolCallId: 'tool_context_test',
        parentMessageId: createdMessage.id,
        executionTime: expect.any(Number),
      });
    });

    it('should increment stepCount in next context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState({ stepCount: 7 });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext?.session!.stepCount).toBe(8);
    });

    it('should include execution time in payload', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext?.payload as GeneralAgentCallToolResultPayload;
      expect(payload.executionTime).toBeGreaterThanOrEqual(0);
      expect(typeof payload.executionTime).toBe('number');
    });

    it('should include isSuccess flag based on error', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({ error: 'Failed' }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext?.payload as GeneralAgentCallToolResultPayload;
      expect(payload.isSuccess).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle assistant message without groupId', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage({ groupId: undefined });
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: undefined,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      expect(result.events).toHaveLength(1);
    });

    it('should handle empty messages array', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      mockStore.dbMessagesMap[context.messageKey] = [];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should use undefined groupId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: undefined,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should handle tool with complex nested arguments', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_complex_args',
        identifier: 'custom-plugin',
        apiName: 'complexApi',
        arguments: JSON.stringify({
          nested: {
            deep: {
              structure: ['array', 'of', 'values'],
              number: 42,
            },
          },
        }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledWith(
        expect.any(String),
        toolCall,
        undefined, // stepContext is undefined when not provided
      );
    });

    it('should handle null topicId', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: null });

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context: { ...context, agentId: 'test-session', topicId: null },
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: undefined,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should handle builtin tool type', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_builtin',
        identifier: 'builtin-search',
        apiName: 'vectorSearch',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          plugin: expect.objectContaining({
            type: 'builtin',
          }),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      expect(result.events).toHaveLength(1);
    });

    it('should handle very long execution time', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { error: null };
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext?.payload as GeneralAgentCallToolResultPayload;
      expect(payload.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.newState.usage.tools.totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multiple User Messages', () => {
    it('should find last assistant message when multiple messages exist', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const messages = [
        {
          id: 'msg_user_1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any,
        {
          id: 'msg_assistant_1',
          role: 'assistant',
          content: 'Hi',
          groupId: 'group_old',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any,
        {
          id: 'msg_user_2',
          role: 'user',
          content: 'Question',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any,
        createAssistantMessage({ groupId: 'group_latest' }),
      ];
      mockStore.dbMessagesMap[context.messageKey] = messages;

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should use the latest assistant message's groupId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group_latest',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('High Priority Coverage - Cancellation Scenarios', () => {
    it('should skip tool execution when parent operation is cancelled after message creation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'cancel-test', topicId: 'topic-test' });

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_cancel_after_msg',
        identifier: 'test-plugin',
        apiName: 'test-api',
        arguments: JSON.stringify({ param: 'value' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // Mock: Simulate parent operation being cancelled after createToolMessage completes
      let toolCallingOpId: string;
      const originalCompleteOperation = mockStore.completeOperation;
      mockStore.completeOperation = vi.fn((opId: string) => {
        originalCompleteOperation(opId);
        // Check if this is the createToolMessage operation completing
        const op = mockStore.operations[opId];
        if (
          op?.type === 'createToolMessage' && // Abort parent toolCalling operation right after message creation completes
          toolCallingOpId
        ) {
          const parentOp = mockStore.operations[toolCallingOpId];
          if (parentOp) {
            parentOp.abortController.abort();
          }
        }
      });

      const originalStartOperation = mockStore.startOperation;
      mockStore.startOperation = vi.fn((config: any) => {
        const result = originalStartOperation(config);
        if (config.type === 'toolCalling') {
          toolCallingOpId = result.operationId;
        }
        return result;
      });

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // Should return early without executing the tool
      expect(result.events).toHaveLength(0);
      // Should have created tool message but not executed it
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalled();
    });

    it('should handle executeToolCall cancellation and update message to aborted state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_exec_cancel',
        identifier: 'slow-tool',
        apiName: 'slow-operation',
        arguments: JSON.stringify({ delay: 5000 }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // Track cancel handler registration
      let executeToolCancelHandler:
        | ((context: OperationCancelContext) => void | Promise<void>)
        | undefined;
      const originalOnOperationCancel = mockStore.onOperationCancel;
      mockStore.onOperationCancel = vi.fn(
        (opId: string, handler: (context: OperationCancelContext) => void | Promise<void>) => {
          const op = mockStore.operations[opId];
          if (op?.type === 'executeToolCall') {
            executeToolCancelHandler = handler;
          }
          return originalOnOperationCancel(opId, handler);
        },
      );

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(executeToolCancelHandler).toBeDefined();

      // Verify cancel handler updates message correctly
      if (executeToolCancelHandler) {
        await executeToolCancelHandler({
          operationId: 'exec-op-id',
          type: 'executeToolCall',
          reason: 'user_cancelled',
        });

        // Should update message content
        expect(mockStore.optimisticUpdateMessageContent).toHaveBeenCalledWith(
          expect.any(String),
          'Tool execution was cancelled by user.',
          undefined,
          expect.objectContaining({ operationId: expect.any(String) }),
        );

        // Should update plugin intervention status
        expect(mockStore.optimisticUpdateMessagePlugin).toHaveBeenCalledWith(
          expect.any(String),
          { intervention: { status: 'aborted' } },
          expect.objectContaining({ operationId: expect.any(String) }),
        );
      }
    });

    it('should skip completion when tool execution finishes after operation was cancelled', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_cancelled_during_exec',
        identifier: 'test-plugin',
        apiName: 'test-api',
        arguments: JSON.stringify({ param: 'value' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // Mock: Simulate operation being cancelled during tool execution
      let executeToolOpId: string | undefined;
      const originalStartOperation = mockStore.startOperation;
      mockStore.startOperation = vi.fn((config: any) => {
        const result = originalStartOperation(config);
        if (config.type === 'executeToolCall') {
          executeToolOpId = result.operationId;
        }
        return result;
      });

      // Mock internal_invokeDifferentTypePlugin to abort operation before returning
      const originalInvoke = mockStore.internal_invokeDifferentTypePlugin;
      mockStore.internal_invokeDifferentTypePlugin = vi.fn(
        async (messageId: string, payload: ChatToolPayload) => {
          const result = await originalInvoke(messageId, payload);
          // Simulate cancellation happening during tool execution
          if (executeToolOpId) {
            const op = mockStore.operations[executeToolOpId];
            if (op) {
              op.abortController.abort();
            }
          }
          return result;
        },
      );

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // Should return early without completing operation or logging success
      expect(result.events).toHaveLength(0);
      // Should have executed the tool
      expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalled();
      // Should not have completed the executeToolCall operation (because it was aborted)
      if (executeToolOpId) {
        const executeToolOp = mockStore.operations[executeToolOpId];
        expect(executeToolOp?.status).not.toBe('completed');
      }
    });
  });

  describe('Tool Stop Execution (Group Management Tools)', () => {
    it('should terminate execution when tool returns stop=true', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: JSON.stringify({ agentId: 'agent-1', message: 'Delegating to agent' }),
          success: true,
          stop: true,
          state: { type: 'speak', agentId: 'agent-1' },
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_speak',
        identifier: 'lobe-group-management',
        apiName: 'speak',
        arguments: JSON.stringify({ agentId: 'agent-1', instruction: 'Please respond' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // Should have tool_result event
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('tool_result');

      // Should mark state as done
      expect(result.newState.status).toBe('done');

      // Should NOT have nextContext (execution stops)
      expect(result.nextContext).toBeUndefined();
    });

    it('should include stop state in result for group management speak tool', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: JSON.stringify({ agentId: 'agent-2' }),
          success: true,
          stop: true,
          state: { type: 'speak', agentId: 'agent-2' },
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_speak_2',
        identifier: 'lobe-group-management',
        apiName: 'speak',
        arguments: JSON.stringify({ agentId: 'agent-2' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const toolResultEvent = result.events[0] as any;
      expect(toolResultEvent.result.stop).toBe(true);
      expect(toolResultEvent.result.state).toEqual({ type: 'speak', agentId: 'agent-2' });
    });

    it('should terminate execution when broadcast tool returns stop=true', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: JSON.stringify({ agentIds: ['agent-1', 'agent-2'], message: 'Broadcasting' }),
          success: true,
          stop: true,
          state: { type: 'broadcast', agentIds: ['agent-1', 'agent-2'] },
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_broadcast',
        identifier: 'lobe-group-management',
        apiName: 'broadcast',
        arguments: JSON.stringify({ agentIds: ['agent-1', 'agent-2'], instruction: 'Discuss' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('done');
      expect(result.nextContext).toBeUndefined();

      const toolResultEvent = result.events[0] as any;
      expect(toolResultEvent.result.state.type).toBe('broadcast');
      expect(toolResultEvent.result.state.agentIds).toEqual(['agent-1', 'agent-2']);
    });

    it('should terminate execution when delegate tool returns stop=true', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: JSON.stringify({ agentId: 'agent-3', reason: 'User requested' }),
          success: true,
          stop: true,
          state: { type: 'delegate', agentId: 'agent-3' },
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_delegate',
        identifier: 'lobe-group-management',
        apiName: 'delegate',
        arguments: JSON.stringify({ agentId: 'agent-3', reason: 'User requested' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('done');
      expect(result.nextContext).toBeUndefined();
    });

    it('should continue normally when stop is false or undefined', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: 'Search results',
          success: true,
          stop: false, // Explicitly false
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_search',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // Should NOT mark state as done
      expect(result.newState.status).toBe('running');

      // Should have nextContext to continue execution
      expect(result.nextContext).toBeDefined();
      expect(result.nextContext?.phase).toBe('tool_result');
    });

    it('should continue normally when result has no stop field', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: 'Some result',
          success: true,
          // No stop field
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const instruction = createCallToolInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('running');
      expect(result.nextContext).toBeDefined();
      expect(result.nextContext?.phase).toBe('tool_result');
    });

    it('should still track usage when stop=true', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: JSON.stringify({ agentId: 'agent-1' }),
          success: true,
          stop: true,
          state: { type: 'speak', agentId: 'agent-1' },
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_usage_stop',
        identifier: 'lobe-group-management',
        apiName: 'speak',
        arguments: JSON.stringify({ agentId: 'agent-1' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // Should still track tool usage even when stopping
      expect(result.newState.usage.tools.totalCalls).toBe(1);
      expect(result.newState.usage.tools.byTool).toHaveLength(1);
      expect(result.newState.usage.tools.byTool[0].name).toBe('lobe-group-management/speak');
    });

    it('should complete operations even when stop=true', async () => {
      // Given
      const mockStore = createMockStore({
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: JSON.stringify({ agentId: 'agent-1' }),
          success: true,
          stop: true,
          state: { type: 'speak', agentId: 'agent-1' },
        }),
      });
      const context = createTestContext();

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_op_complete',
        identifier: 'lobe-group-management',
        apiName: 'speak',
        arguments: JSON.stringify({ agentId: 'agent-1' }),
        type: 'builtin',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // All 3 operations should be completed
      expect(mockStore.completeOperation).toHaveBeenCalledTimes(3);
    });
  });

  describe('Group Orchestration: subAgentId Support', () => {
    it('should use subAgentId for tool message agentId when present', async () => {
      // Given - Group orchestration scenario
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        subAgentId: 'worker-agent',
        topicId: 'group-topic',
      });

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_sub_agent',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - tool message should be created with subAgentId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'worker-agent', // Should use subAgentId
          role: 'tool',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should fall back to agentId for tool message when subAgentId is not present', async () => {
      // Given - Normal scenario without subAgentId
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });

      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap[context.messageKey] = [assistantMessage];

      const toolCall: ChatToolPayload = {
        id: 'tool_normal',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createCallToolInstruction(toolCall);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'call_tool',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - tool message should be created with agentId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'normal-agent', // Should use agentId
          role: 'tool',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });
});
