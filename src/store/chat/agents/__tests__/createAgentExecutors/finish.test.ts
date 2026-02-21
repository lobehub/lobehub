import { type AgentEventDone } from '@lobechat/agent-runtime';
import { describe, expect, it } from 'vitest';

import { createFinishInstruction } from './fixtures';
import { createMockStore } from './fixtures/mockStore';
import { createInitialState, createTestContext, executeWithMockContext } from './helpers';

describe('finish executor', () => {
  describe('Basic Behavior', () => {
    it('should complete execution successfully with reason', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed', 'All tasks finished');
      const state = createInitialState({ operationId: 'test-session', stepCount: 5 });

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('done');
      expect(result.newState.lastModified).toBeDefined();
      expect(new Date(result.newState.lastModified).getTime()).toBeGreaterThanOrEqual(
        new Date(state.lastModified).getTime(),
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'done',
        reason: 'completed',
        reasonDetail: 'All tasks finished',
      });
    });

    it('should preserve all state fields except status and lastModified', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
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
        executor: 'finish',
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

    it('should work without reasonDetail', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('max_turns_reached');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('done');
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent).toMatchObject({
        type: 'done',
        reason: 'max_turns_reached',
      });
      expect(doneEvent.reasonDetail).toBeUndefined();
    });
  });

  describe('Different Finish Reasons', () => {
    it('should handle "completed" reason', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed', 'Task completed successfully');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reason).toBe('completed');
      expect(doneEvent.reasonDetail).toBe('Task completed successfully');
    });

    it('should handle "max_turns_reached" reason', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction(
        'max_turns_reached',
        'Maximum conversation turns exceeded',
      );
      const state = createInitialState({ stepCount: 100 });

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reason).toBe('max_turns_reached');
      expect(result.newState.stepCount).toBe(100);
    });

    it('should handle "error" reason', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('error', 'Internal runtime error occurred');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reason).toBe('error');
      expect(result.newState.status).toBe('done');
    });

    it('should handle "user_cancelled" reason', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('user_cancelled', 'User requested cancellation');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reason).toBe('user_cancelled');
    });
  });

  describe('Event Structure', () => {
    it('should emit done event with finalState', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.events).toHaveLength(1);
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent).toHaveProperty('type', 'done');
      expect(doneEvent).toHaveProperty('finalState');
      expect(doneEvent).toHaveProperty('reason');
      expect(doneEvent.finalState).toEqual(result.newState);
    });

    it('should include both reason and reasonDetail in event', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed', 'Detailed completion message');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reason).toBe('completed');
      expect(doneEvent.reasonDetail).toBe('Detailed completion message');
    });
  });

  describe('State Immutability', () => {
    it('should not mutate original state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const state = createInitialState({ operationId: 'test', stepCount: 5 });
      const originalState = JSON.parse(JSON.stringify(state));

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(state).toEqual(originalState);
      expect(result.newState).not.toBe(state);
      expect(result.newState.status).toBe('done');
      expect(state.status).toBe('running');
    });

    it('should create deep clone of state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const state = createInitialState({
        messages: [{ role: 'user', content: 'test' } as any],
      });

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.messages).toEqual(state.messages);
      expect(result.newState.messages).not.toBe(state.messages);
    });
  });

  describe('Timestamp Handling', () => {
    it('should update lastModified timestamp', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const oldTimestamp = new Date('2024-01-01').toISOString();
      const state = createInitialState({ lastModified: oldTimestamp });

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
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

    it('should use ISO 8601 format for lastModified', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(result.newState.lastModified).toMatch(isoPattern);
    });
  });

  describe('Store Interaction', () => {
    it('should not call any store methods', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const state = createInitialState();

      // When
      await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - finish executor is pure and doesn't interact with store
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(mockStore.startOperation).not.toHaveBeenCalled();
      expect(mockStore.completeOperation).not.toHaveBeenCalled();
      expect(mockStore.failOperation).not.toHaveBeenCalled();
      expect(mockStore.onOperationCancel).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty reason string', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('');
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.status).toBe('done');
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reason).toBe('');
    });

    it('should handle very long reasonDetail', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const longDetail = 'A'.repeat(10000);
      const instruction = createFinishInstruction('completed', longDetail);
      const state = createInitialState();

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const doneEvent = result.events[0] as AgentEventDone;
      expect(doneEvent.reasonDetail).toBe(longDetail);
      expect(doneEvent.reasonDetail?.length).toBe(10000);
    });

    it('should handle state with empty messages array', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createFinishInstruction('completed');
      const state = createInitialState({ messages: [] });

      // When
      const result = await executeWithMockContext({
        executor: 'finish',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.messages).toEqual([]);
      expect(result.newState.status).toBe('done');
    });
  });
});
