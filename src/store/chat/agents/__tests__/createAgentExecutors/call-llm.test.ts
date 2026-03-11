import { type GeneralAgentCallLLMResultPayload } from '@lobechat/agent-runtime';
import { LOADING_FLAT } from '@lobechat/const';
import { type MessageToolCall } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';

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

// Mock external services at module level
vi.mock('@/services/chat', () => ({
  chatService: {
    createAssistantMessageStream: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    updateMessage: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopicSummary: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: vi.fn().mockReturnValue({
    uploadBase64FileWithProgress: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {},
}));

vi.mock('@/store/agent/store', () => ({
  getAgentStoreState: vi.fn().mockReturnValue({}),
}));

/**
 * Helper to mock chatService.createAssistantMessageStream
 * Simulates streaming by calling onMessageHandle with chunks then onFinish
 */
const mockStreamResponse = (response: {
  content?: string;
  finishType?: string;
  tool_calls?: MessageToolCall[];
  usage?: any;
}) => {
  const { content = '', finishType = 'stop', tool_calls, usage } = response;

  vi.mocked(chatService.createAssistantMessageStream).mockImplementation(async (params: any) => {
    // Simulate text streaming
    if (content && params.onMessageHandle) {
      await params.onMessageHandle({ type: 'text', text: content });
    }

    // Simulate tool call streaming
    if (tool_calls && params.onMessageHandle) {
      await params.onMessageHandle({
        isAnimationActives: tool_calls.map(() => true),
        tool_calls,
        type: 'tool_calls',
      });
    }

    // Simulate finish
    if (params.onFinish) {
      await params.onFinish(content, {
        toolCalls: tool_calls,
        type: finishType,
        usage,
      });
    }
  });
};

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

      mockStreamResponse({ content: 'AI response' });
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

    it('should call chatService.createAssistantMessageStream with correct params', async () => {
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

      mockStreamResponse({ content: 'AI response' });
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
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            model: 'gpt-4',
            provider: 'openai',
          }),
        }),
      );
    });

    it('should associate message with operation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response' });
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
      // The stream should still be called (message reuse doesn't skip LLM call)
      expect(chatService.createAssistantMessageStream).toHaveBeenCalled();
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

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({
        content: 'AI response',
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

      mockStreamResponse({
        content: 'AI response',
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

      mockStreamResponse({ content: 'AI response', usage: undefined });
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

      mockStreamResponse({ content: 'Partial response', finishType: 'abort' });
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

      mockStreamResponse({ content: 'Partial response', finishType: 'abort' });
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

      const toolCallsRaw: MessageToolCall[] = [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: 'test' }),
          },
        },
      ];

      mockStreamResponse({
        content: '',
        finishType: 'abort',
        tool_calls: toolCallsRaw,
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
      });
      expect(payload.toolsCalling.length).toBeGreaterThan(0);
    });

    it('should not throw error on abort', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'Partial', finishType: 'abort' });
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

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'Here is the result' });
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

      const toolCallsRaw: MessageToolCall[] = [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: 'AI news' }),
          },
        },
      ];

      mockStreamResponse({
        content: '',
        finishType: 'tool_calls',
        tool_calls: toolCallsRaw,
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
      expect(payload.hasToolsCalling).toBe(true);
      expect(payload.toolsCalling.length).toBeGreaterThan(0);
    });

    it('should increment stepCount', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ stepCount: 5 });

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response', usage: stepUsage });
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

      mockStreamResponse({ content: 'Hi there' });
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

      mockStreamResponse({ content: 'AI response' });
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
      const originalState = structuredClone(state);

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response' });
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
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            messages: [],
          }),
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

      const toolCallsRaw: MessageToolCall[] = [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: 'AI' }),
          },
        },
        {
          id: 'tool_2',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____craw',
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        },
        {
          id: 'tool_3',
          type: 'function',
          function: {
            name: 'lobe-image-generator____generate',
            arguments: JSON.stringify({ prompt: 'AI art' }),
          },
        },
      ];

      mockStreamResponse({
        content: '',
        finishType: 'tool_calls',
        tool_calls: toolCallsRaw,
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

      mockStreamResponse({ content: 'AI response' });
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
      mockStreamResponse({ content: 'AI response' });
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
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            messages: expect.not.arrayContaining([
              expect.objectContaining({ id: 'msg_assistant' }),
            ]),
          }),
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

      mockStreamResponse({ content: 'Claude response' });
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
          model: 'claude-3-opus',
          provider: 'anthropic',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            model: 'claude-3-opus',
            provider: 'anthropic',
          }),
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

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response' });
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
          agentId: 'test-session',
          topicId: 'test-topic',
          threadId,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
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

      mockStreamResponse({ content: 'AI response' });
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
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent', // Main agent (supervisor)
        scope: 'group_agent',
        subAgentId: 'worker-agent', // Actual executing agent
        topicId: 'group-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response from worker agent' });
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
          agentId: 'worker-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should fall back to agentId when subAgentId is not present', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
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
          agentId: 'normal-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should pass groupId to message when present in operation context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        scope: 'group_agent',
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

      mockStreamResponse({ content: 'AI response' });
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
          groupId: 'group-123',
          agentId: 'worker-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should use subAgentId even without explicit scope when groupId is present (backward compatibility)', async () => {
      // Given - Group scenario without explicit scope (backward compatibility test)
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        subAgentId: 'worker-agent',
        groupId: 'group-123',
        topicId: 'group-topic',
        // No explicit scope - should infer from groupId
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should still use subAgentId for backward compatibility
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'worker-agent', // Should use subAgentId even without explicit scope
          groupId: 'group-123',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should not include groupId when not in group chat context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
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
          agentId: 'normal-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      // Verify groupId is not in the call (undefined)
      const callArgs = vi.mocked(mockStore.optimisticCreateMessage).mock.calls[0][0];
      expect(callArgs.groupId).toBeUndefined();
    });
  });

  describe('Supervisor Metadata', () => {
    it('should add isSupervisor metadata when operation context indicates supervisor', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        topicId: 'group-topic',
      });

      // Setup operation with isSupervisor flag
      mockStore.operations[context.operationId] = {
        id: context.operationId,
        type: 'execAgentRuntime',
        status: 'running',
        context: {
          agentId: 'supervisor-agent',
          topicId: 'group-topic',
          isSupervisor: true,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'Supervisor response' });
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
          metadata: { isSupervisor: true },
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should not add isSupervisor metadata for normal agents', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'Normal response' });
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
          metadata: undefined,
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('createAssistantMessage flag', () => {
    it('should create message even when skipCreateFirstMessage is true if createAssistantMessage is explicitly true', async () => {
      // Given - This scenario happens after compression, where a new assistant message is needed
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_parent' });
      const instruction = createCallLLMInstruction({
        createAssistantMessage: true,
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'Post-compression response' });
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

      // Then - should still create a new assistant message
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: LOADING_FLAT,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should skip message creation only on first call when skipCreateFirstMessage is true', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_parent' });
      const instruction1 = createCallLLMInstruction();
      const instruction2 = createCallLLMInstruction({ createAssistantMessage: undefined });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // Ensure operation exists for the context
      mockStore.operations[context.operationId] = {
        id: context.operationId,
        type: 'execAgentRuntime',
        status: 'running',
        context: {
          agentId: context.agentId,
          topicId: context.topicId,
          messageId: context.parentId,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      // When - First call should skip, second should create
      const { createAgentExecutors } = await import('@/store/chat/agents/createAgentExecutors');
      const executors = createAgentExecutors({
        agentConfig: {
          agentConfig: { model: 'gpt-4', provider: 'openai' } as any,
          chatConfig: {} as any,
          isBuiltinAgent: false,
          plugins: [],
        },
        get: () => mockStore,
        messageKey: context.messageKey,
        operationId: context.operationId,
        parentId: context.parentId,
        skipCreateFirstMessage: true,
      });

      await executors.call_llm!(instruction1, state);

      // Then - First call should NOT create message
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();

      // When - Second call
      mockStreamResponse({ content: 'Second response' });
      await executors.call_llm!(instruction2, state);

      // Then - Second call SHOULD create message
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalled();
    });
  });
});
