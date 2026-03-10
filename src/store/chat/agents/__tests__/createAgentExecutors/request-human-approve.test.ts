import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  createAssistantMessage,
  createMockStore,
  createRequestHumanApproveInstruction,
} from './fixtures';
import { createInitialState, createTestContext, executeWithMockContext } from './helpers';

describe('request_human_approve executor', () => {
  describe('Basic Behavior', () => {
    it('should create tool messages with pending intervention status', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage({ id: 'msg_assistant' });
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'default',
        },
      ];

      const instruction = createRequestHumanApproveInstruction(toolCalls);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
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
          content: '',
          plugin: toolCalls[0],
          pluginIntervention: { status: 'pending' },
          tool_call_id: 'tool_1',
          parentId: 'msg_assistant',
          groupId: assistantMessage.groupId,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should update state to waiting_for_human', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('waiting_for_human');
    });

    it('should store pendingToolsCalling in state', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

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
          identifier: 'lobe-web-browsing',
          apiName: 'craw',
          arguments: JSON.stringify({ url: 'https://example.com' }),
          type: 'default',
        },
      ];

      const instruction = createRequestHumanApproveInstruction(toolCalls);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.pendingToolsCalling).toEqual(toolCalls);
    });

    it('should emit human_approve_required event', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'default',
        },
      ];

      const instruction = createRequestHumanApproveInstruction(toolCalls);
      const state = createInitialState({ operationId: 'test-session' });

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'human_approve_required',
        pendingToolsCalling: toolCalls,
        operationId: 'test-session',
      });
    });
  });

  describe('Assistant Message Handling', () => {
    it('should throw error if no assistant message found', async () => {
      // Given
      const mockStore = createMockStore();
      mockStore.dbMessagesMap['test-session_test-topic'] = []; // No messages

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState();

      // When/Then
      await expect(
        executeWithMockContext({
          executor: 'request_human_approve',
          instruction,
          state,
          mockStore,
          context,
        }),
      ).rejects.toThrow('No assistant message found for intervention');
    });

    it('should use groupId from assistant message', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage({
        id: 'msg_assistant',
        groupId: 'group_123',
      });
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group_123',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should use assistant message id as parentId', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage({ id: 'msg_assistant_456' });
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_assistant_456',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('Skip Create Tool Message Mode', () => {
    it('should skip message creation when skipCreateToolMessage is true', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const toolCalls: ChatToolPayload[] = [
        {
          id: 'tool_1',
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: JSON.stringify({ query: 'test' }),
          type: 'default',
        },
      ];

      const instruction = createRequestHumanApproveInstruction(toolCalls, {
        skipCreateToolMessage: true,
      });
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.events).toHaveLength(1);
    });
  });

  describe('Multiple Tool Messages', () => {
    it('should create multiple tool messages for multiple pending tools', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
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
          arguments: JSON.stringify({ prompt: 'test' }),
          type: 'default',
        },
      ];

      const instruction = createRequestHumanApproveInstruction(toolCalls);
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(3);
      toolCalls.forEach((toolCall) => {
        expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            plugin: expect.objectContaining({
              id: toolCall.id,
            }),
            tool_call_id: toolCall.id,
            pluginIntervention: { status: 'pending' },
          }),
          expect.objectContaining({
            operationId: expect.any(String),
          }),
        );
      });
    });
  });

  describe('State Management', () => {
    it('should update lastModified timestamp', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const oldTimestamp = new Date('2024-01-01').toISOString();
      const state = createInitialState({ lastModified: oldTimestamp });

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
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
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
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
        executor: 'request_human_approve',
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
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState({ status: 'running' });
      const originalState = JSON.parse(JSON.stringify(state));

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(state).toEqual(originalState);
      expect(result.newState).not.toBe(state);
      expect(result.newState.status).toBe('waiting_for_human');
      expect(state.status).toBe('running');
    });
  });

  describe('Error Handling', () => {
    it('should throw error if message creation fails', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockResolvedValue(null),
      });
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState();

      // When/Then
      await expect(
        executeWithMockContext({
          executor: 'request_human_approve',
          instruction,
          state,
          mockStore,
          context,
        }),
      ).rejects.toThrow('Failed to create tool message');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large number of pending tools', async () => {
      // Given
      const mockStore = createMockStore();
      const assistantMessage = createAssistantMessage();
      mockStore.dbMessagesMap['test-session_test-topic'] = [assistantMessage];

      const context = createTestContext();
      const toolCalls: ChatToolPayload[] = Array.from({ length: 50 }, (_, i) => ({
        id: `tool_${i}`,
        identifier: 'lobe-web-browsing',
        apiName: 'search',
        arguments: JSON.stringify({ query: `query_${i}` }),
        type: 'default' as const,
      }));

      const instruction = createRequestHumanApproveInstruction(toolCalls);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(50);
      expect(result.newState.pendingToolsCalling).toHaveLength(50);
    });

    it('should find last assistant message in conversation with multiple messages', async () => {
      // Given
      const mockStore = createMockStore();
      const messages = [
        createAssistantMessage({ id: 'msg_1' }),
        { id: 'msg_user_1', role: 'user', content: 'Hello' } as any,
        createAssistantMessage({ id: 'msg_2' }),
        { id: 'msg_user_2', role: 'user', content: 'Follow up' } as any,
        createAssistantMessage({ id: 'msg_3_last' }),
      ];
      mockStore.dbMessagesMap['test-session_test-topic'] = messages;

      const context = createTestContext();
      const instruction = createRequestHumanApproveInstruction();
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'request_human_approve',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_3_last',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });
});
