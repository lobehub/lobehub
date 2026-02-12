import { type AgentEventDone } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  createAssistantMessage,
  createMockStore,
  createResolveAbortedToolsInstruction,
} from './fixtures';
import { createInitialState, createTestContext, executeWithMockContext } from './helpers';

describe('resolve_aborted_tools executor', () => {
  describe('Basic Behavior', () => {
    it('should create tool messages with aborted status', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: 'test-topic' });

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'default',
        },
      ];

      const parentMessage = createAssistantMessage();
      const instruction = createResolveAbortedToolsInstruction(toolCalls, parentMessage.id);
      const state = createInitialState({ operationId: 'test-session' });

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(1);
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'tool',
          content: 'Tool execution was aborted by user.',
          plugin: toolCalls[0],
          pluginIntervention: { status: 'aborted' },
          tool_call_id: 'tool_1',
          agentId: 'test-session',
          topicId: 'test-topic',
          parentId: parentMessage.id,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should handle multiple aborted tools', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session' });

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test1' }),
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
          arguments: JSON.stringify({ prompt: 'test prompt' }),
          type: 'default',
        },
      ];

      const instruction = createResolveAbortedToolsInstruction(toolCalls);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(3);

      // Verify each tool message
      toolCalls.forEach((toolCall) => {
        expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'tool',
            content: 'Tool execution was aborted by user.',
            plugin: toolCall,
            pluginIntervention: { status: 'aborted' },
            tool_call_id: toolCall.id,
          }),
          expect.objectContaining({
            operationId: expect.any(String),
          }),
        );
      });
    });

    it('should mark state as done', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState({ status: 'waiting_for_human' });

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('done');
    });

    it('should emit done event with user_aborted reason', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent).toMatchObject({
        type: 'done',
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
        finalState: result.newState,
      });
    });
  });

  describe('Tool Message Creation', () => {
    it('should create tool messages with correct structure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'sess_123', topicId: 'topic_456' });

      const toolCall: ChatToolPayload = {
        id: 'tool_abc',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'AI news' }),
        type: 'default',
      };

      const instruction = createResolveAbortedToolsInstruction([toolCall], 'msg_parent');
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context: { ...context, agentId: 'sess_123', topicId: 'topic_456' },
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'tool',
          content: 'Tool execution was aborted by user.',
          plugin: toolCall,
          pluginIntervention: { status: 'aborted' },
          tool_call_id: 'tool_abc',
          parentId: 'msg_parent',
          agentId: 'sess_123',
          topicId: 'topic_456',
          threadId: undefined,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should preserve tool payload details', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

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

      const instruction = createResolveAbortedToolsInstruction([toolCall]);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
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

    it('should handle tool without topicId', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: null });
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
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
  });

  describe('State Management', () => {
    it('should update lastModified timestamp', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const oldTimestamp = new Date('2024-01-01').toISOString();
      const state = createInitialState({ lastModified: oldTimestamp });

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.lastModified).not.toBe(oldTimestamp);
      expect(new Date(result.newState.lastModified).getTime()).toBeGreaterThan(
        new Date(oldTimestamp).getTime(),
      );
    });

    it('should preserve other state fields', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState({
        operationId: 'test-session',
        stepCount: 10,
        messages: [{ role: 'user', content: 'test' } as any],
        cost: {
          total: 0.05,
          calculatedAt: new Date().toISOString(),
          currency: 'USD',
          llm: { total: 0.04, currency: 'USD', byModel: [] },
          tools: { total: 0.01, currency: 'USD', byTool: [] },
        },
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 2,
            processingTimeMs: 100,
            tokens: {
              input: 100,
              output: 200,
              total: 300,
            },
          },
          tools: {
            totalCalls: 2,
            totalTimeMs: 500,
            byTool: [],
          },
        },
      });

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.operationId).toBe(state.operationId);
      expect(result.newState.stepCount).toBe(state.stepCount);
      expect(result.newState.messages).toEqual(state.messages);
      expect(result.newState.usage).toEqual(state.usage);
    });

    it('should not mutate original state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState({ status: 'waiting_for_human' });
      const originalState = JSON.parse(JSON.stringify(state));

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(state).toEqual(originalState);
      expect(result.newState).not.toBe(state);
      expect(result.newState.status).toBe('done');
      expect(state.status).toBe('waiting_for_human');
    });
  });

  describe('Event Handling', () => {
    it('should emit single done event', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('done');
    });

    it('should include finalState in event', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.finalState).toEqual(result.newState);
      expect(doneEvent.finalState.status).toBe('done');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty toolsCalling array', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      // Manually construct instruction with truly empty array
      const instruction: any = {
        type: 'resolve_aborted_tools',
        payload: {
          toolsCalling: [],
          parentMessageId: 'msg_parent',
        },
      };
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('done');
      expect(result.events).toHaveLength(1);
    });

    it('should handle tools with special characters in arguments', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const toolCall: ChatToolPayload = {
        id: 'tool_special',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({
          query: 'Test with "quotes" and \'apostrophes\' and <tags>',
        }),
        type: 'default',
      };

      const instruction = createResolveAbortedToolsInstruction([toolCall]);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
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

    it('should handle very large toolsCalling array', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const toolCalls: ChatToolPayload[] = Array.from({ length: 50 }, (_, i) => ({
        id: `tool_${i}`,
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: `query_${i}` }),
        type: 'default' as const,
      }));

      const instruction = createResolveAbortedToolsInstruction(toolCalls);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(50);
      expect(result.newState.status).toBe('done');
    });

    it('should handle failed message creation gracefully', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockResolvedValue(null),
      });
      const context = createTestContext();
      const instruction = createResolveAbortedToolsInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should complete despite message creation failure
      expect(result.newState.status).toBe('done');
      expect(result.events).toHaveLength(1);
    });
  });

  describe('Different Tool Types', () => {
    it('should handle builtin tools', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const toolCall: ChatToolPayload = {
        id: 'tool_builtin',
        identifier: 'builtin-search',
        apiName: 'vectorSearch',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'builtin',
      };

      const instruction = createResolveAbortedToolsInstruction([toolCall]);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
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
    });

    it('should handle default/plugin tools', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const toolCall: ChatToolPayload = {
        id: 'tool_plugin',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: 'test' }),
        type: 'default',
      };

      const instruction = createResolveAbortedToolsInstruction([toolCall]);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          plugin: expect.objectContaining({
            type: 'default',
          }),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should handle mixed tool types', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'default',
        },
        {
          id: 'tool_2',
          identifier: 'builtin-search',
          apiName: 'vectorSearch',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'builtin',
        },
      ];

      const instruction = createResolveAbortedToolsInstruction(toolCalls);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrent Tool Message Creation', () => {
    it('should create all tool messages concurrently', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const toolCalls: ChatToolPayload[] = Array.from({ length: 5 }, (_, i) => ({
        id: `tool_${i}`,
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: `query_${i}` }),
        type: 'default' as const,
      }));

      const instruction = createResolveAbortedToolsInstruction(toolCalls);
      const state = createInitialState();

      const startTime = Date.now();

      // When
      await executeWithMockContext({
        executor: 'resolve_aborted_tools',
        instruction,
        state,
        mockStore,
        context,
      });

      const duration = Date.now() - startTime;

      // Then - should complete quickly (concurrent execution)
      expect(duration).toBeLessThan(100); // Should be fast since mocked
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(5);
    });
  });
});
