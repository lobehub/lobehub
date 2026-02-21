import { type GeneralAgentCallLLMResultPayload } from '@lobechat/agent-runtime';
import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  createAssistantMessage,
  createCallLLMInstruction,
  createMockStore,
  createUserMessage,
} from './fixtures';
import {
  createInitialState,
  createTestContext,
  executeWithMockContext,
  expectMessageCreated,
  expectNextContext,
  expectValidExecutorResult,
} from './helpers';

describe('call_llm executor', () => {
  describe('Basic Behavior', () => {
    it('should create assistant message with LOADING_FLAT content', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: 'test-topic' });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: 'test-session' });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectMessageCreated(mockStore, 'assistant');
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'test-session',
          content: LOADING_FLAT,
          role: 'assistant',
          model: 'gpt-4',
          provider: 'openai',
          topicId: 'test-topic',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should call internal_fetchAIChatMessage with correct params', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const userMsg = createUserMessage({ content: 'Hello' });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [userMsg],
      });
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: expect.any(String),
          messages: [userMsg], // Should exclude assistant message
          model: 'gpt-4',
          provider: 'openai',
          operationId: context.operationId,
        }),
      );
    });

    it('should associate message with operation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.associateMessageWithOperation).toHaveBeenCalledWith(
        expect.any(String),
        context.operationId,
      );
    });

    it('should return correct result structure with events and newState', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectValidExecutorResult(result);
      expect(result.events).toEqual([]);
      expect(result.newState).toBeDefined();
      expect(result.nextContext).toBeDefined();
    });
  });

  describe('Skip Create First Message Mode', () => {
    it('should reuse parentId when skipCreateFirstMessage is true', async () => {
      // Given
      const mockStore = createMockStore();
      const parentId = 'msg_existing';
      const context = createTestContext({ parentId });
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
        skipCreateFirstMessage: true,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: parentId,
        }),
      );
    });
  });

  describe('Parent Message ID Handling', () => {
    it('should use llmPayload.parentMessageId if provided', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_context_parent' });
      const instruction = createCallLLMInstruction({
        parentMessageId: 'msg_payload_parent',
      });
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_payload_parent',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should fall back to context.parentId if parentMessageId not provided', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_context_parent' });
      const instruction = createCallLLMInstruction({
        parentMessageId: undefined,
      });
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_context_parent',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('Usage Tracking', () => {
    it('should accumulate LLM usage from currentStepUsage', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
      });
      const state = createInitialState({
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 1,
            processingTimeMs: 0,
            tokens: {
              input: 100,
              output: 50,
              total: 150,
            },
          },
          tools: {
            byTool: [],
            totalCalls: 0,
            totalTimeMs: 0,
          },
        },
      });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
        usage: {
          totalInputTokens: 50,
          totalOutputTokens: 30,
          totalTokens: 80,
        },
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.usage).toBeDefined();
      expect(result.newState.usage.llm.tokens.input).toBeGreaterThan(state.usage.llm.tokens.input);
      expect(result.newState.usage.llm.tokens.output).toBeGreaterThan(
        state.usage.llm.tokens.output,
      );
    });

    it('should update state.usage and state.cost correctly', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
      });
      const state = createInitialState({
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 0,
            processingTimeMs: 0,
            tokens: {
              input: 0,
              output: 0,
              total: 0,
            },
          },
          tools: {
            byTool: [],
            totalCalls: 0,
            totalTimeMs: 0,
          },
        },
      });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
        usage: {
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalTokens: 150,
          cost: 0.002,
        },
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.usage).toBeDefined();
      expect(result.newState.cost).toBeDefined();
    });

    it('should handle no usage data returned', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
        usage: undefined,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should preserve original usage
      expect(result.newState.usage).toEqual(state.usage);
    });
  });

  describe('Abort Handling', () => {
    it('should return nextContext with phase: human_abort when finishType is abort', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ stepCount: 3 });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'Partial response',
        finishType: 'abort',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectNextContext(result, 'human_abort');
      expect(result.nextContext!.session!.status).toBe('running');
      expect(result.nextContext!.session!.stepCount).toBe(4);
    });

    it('should include correct payload with reason and result when aborted', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'Partial response',
        finishType: 'abort',
        isFunctionCall: false,
        tool_calls: undefined,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        reason: 'user_cancelled',
        hasToolsCalling: false,
        result: {
          content: 'Partial response',
          tool_calls: undefined,
        },
      });
    });

    it('should include toolsCalling in abort payload when tools were being called', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'default',
        },
      ];

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: '',
        finishType: 'abort',
        isFunctionCall: true,
        tools: toolCalls,
        tool_calls: [{ id: 'tool_1', type: 'function', function: { name: 'search' } }],
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        reason: 'user_cancelled',
        hasToolsCalling: true,
        toolsCalling: toolCalls,
      });
    });

    it('should not throw error on abort', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'Partial',
        finishType: 'abort',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When & Then - should not throw
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      expect(result).toBeDefined();
      expect(result.nextContext!.phase).toBe('human_abort');
    });
  });

  describe('Normal Completion', () => {
    it('should return nextContext with phase: llm_result on normal completion', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectNextContext(result, 'llm_result');
    });

    it('should include hasToolsCalling and result in llm_result payload', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'Here is the result',
        finishType: 'stop',
        isFunctionCall: false,
        tool_calls: undefined,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        hasToolsCalling: false,
        result: {
          content: 'Here is the result',
          tool_calls: undefined,
        },
      });
    });

    it('should include toolCalling when LLM returns tools', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'AI news' }),
          type: 'default',
        },
      ];

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: '',
        finishType: 'tool_calls',
        isFunctionCall: true,
        tools: toolCalls,
        tool_calls: [{ id: 'tool_1', type: 'function', function: { name: 'search' } }],
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        hasToolsCalling: true,
        toolsCalling: toolCalls,
      });
    });

    it('should increment stepCount', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ stepCount: 5 });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.session!.stepCount).toBe(6);
    });

    it('should include stepUsage in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 0,
            processingTimeMs: 0,
            tokens: {
              input: 0,
              output: 0,
              total: 0,
            },
          },
          tools: {
            byTool: [],
            totalCalls: 0,
            totalTimeMs: 0,
          },
        },
      });

      const stepUsage = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
        usage: stepUsage,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.stepUsage).toEqual(stepUsage);
    });
  });

  describe('State Management', () => {
    it('should update messages from dbMessagesMap', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ messages: [] });

      const updatedMessages = [
        createUserMessage({ content: 'Hello' }),
        createAssistantMessage({ content: 'Hi there' }),
      ];

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'Hi there',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = updatedMessages;

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
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
      const instruction = createCallLLMInstruction();
      const state = createInitialState({
        operationId: 'test-session',
        stepCount: 10,
        status: 'running',
      });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.operationId).toBe(state.operationId);
      expect(result.newState.stepCount).toBe(state.stepCount);
      expect(result.newState.status).toBe(state.status);
    });

    it('should not mutate original state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({
        messages: [createUserMessage()],
      });
      const originalState = JSON.parse(JSON.stringify(state));

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [createUserMessage(), createAssistantMessage()];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(state).toEqual(originalState);
      expect(result.newState).not.toBe(state);
    });
  });

  describe('Edge Cases', () => {
    it('should throw error when message creation fails', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockResolvedValue(null),
      });
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      // When & Then
      await expect(
        executeWithMockContext({
          executor: 'call_llm',
          instruction,
          state,
          mockStore,
          context,
        }),
      ).rejects.toThrow('Failed to create assistant message');
    });

    it('should handle empty messages array', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        messages: [],
      });
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [],
        }),
      );
      expect(result).toBeDefined();
    });

    it('should handle multiple tools returned', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'AI' }),
          type: 'default',
        },
        {
          id: 'tool_2',
          identifier: 'lobe-web-browsing',
          apiName: 'craw',
          arguments: JSON.stringify({ url: 'https://example.com' }),
          type: 'default',
        },
        {
          id: 'tool_3',
          identifier: 'lobe-image-generator',
          apiName: 'generate',
          arguments: JSON.stringify({ prompt: 'AI art' }),
          type: 'default',
        },
      ];

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: '',
        finishType: 'tool_calls',
        isFunctionCall: true,
        tools: toolCalls,
        tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function' as const })),
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload.toolsCalling).toHaveLength(3);
      expect(payload.hasToolsCalling).toBe(true);
    });

    it('should handle empty dbMessagesMap', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ messages: [createUserMessage()] });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      // dbMessagesMap[messageKey] doesn't exist

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should default to empty array
      expect(result.newState.messages).toEqual([]);
    });
  });

  describe('Message Filtering', () => {
    it('should exclude assistant message from messages sent to LLM', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const userMsg = createUserMessage({ id: 'msg_user', content: 'Hello' });
      const assistantMsg = createAssistantMessage({ id: 'msg_assistant', content: 'Loading...' });

      const instruction = createCallLLMInstruction({
        messages: [userMsg, assistantMsg],
      });
      const state = createInitialState();

      mockStore.optimisticCreateMessage = vi.fn().mockResolvedValue({
        id: 'msg_assistant',
        role: 'assistant',
        content: LOADING_FLAT,
      });
      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should filter out the assistant message with matching ID
      expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.not.arrayContaining([expect.objectContaining({ id: 'msg_assistant' })]),
        }),
      );
    });
  });

  describe('Different Model Configurations', () => {
    it('should handle different model and provider combinations', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        model: 'claude-3-opus',
        provider: 'anthropic',
      });
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'Claude response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus',
          provider: 'anthropic',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus',
          provider: 'anthropic',
        }),
      );
    });
  });

  describe('Context Propagation', () => {
    it('should include correct messageCount in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const messages = [
        createUserMessage(),
        createAssistantMessage(),
        createUserMessage(),
        createAssistantMessage(),
      ];

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = messages;

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.session!.messageCount).toBe(4);
    });

    it('should preserve sessionId in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ operationId: 'custom-session-123' });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      // Note: AgentRuntimeContext.session uses sessionId for backward compatibility
      expect(result.nextContext!.session!.sessionId).toBe('custom-session-123');
    });
  });

  describe('Thread Support', () => {
    it('should handle threadId when provided in operation context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: 'test-topic' });
      const threadId = 'thread_123';

      // Setup operation with threadId
      mockStore.operations[context.operationId] = {
        id: context.operationId,
        type: 'execAgentRuntime',
        status: 'running',
        context: {
          sessionId: 'test-session',
          topicId: 'test-topic',
          threadId,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should handle undefined threadId', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: undefined,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('Group Orchestration: subAgentId Support', () => {
    it('should use subAgentId for message.agentId when present in operation context', async () => {
      // Given - Group orchestration scenario where subAgentId is the actual executing agent
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent', // Main agent (supervisor)
        subAgentId: 'worker-agent', // Actual executing agent
        topicId: 'group-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response from worker agent',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - message should be created with subAgentId as the agentId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'worker-agent', // Should use subAgentId, not agentId
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should fall back to agentId when subAgentId is not present', async () => {
      // Given - Normal scenario without subAgentId
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
        // No subAgentId
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - message should be created with agentId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'normal-agent', // Should use agentId when no subAgentId
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should pass groupId to message when present in operation context', async () => {
      // Given - Group chat scenario
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        subAgentId: 'worker-agent',
        groupId: 'group-123',
        topicId: 'group-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - message should be created with groupId
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-123',
          agentId: 'worker-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should not include groupId when not in group chat context', async () => {
      // Given - Normal (non-group) scenario
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
        // No groupId
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStore.internal_fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: 'AI response',
        finishType: 'stop',
        isFunctionCall: false,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - message should be created without groupId (undefined)
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: undefined,
          agentId: 'normal-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });
});
