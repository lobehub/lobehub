import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type StreamEvent } from '@/services/agentRuntime';
import { useChatStore } from '@/store/chat/store';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// Test Constants
const TEST_IDS = {
  ASSISTANT_MESSAGE_ID: 'test-assistant-id',
  OPERATION_ID: 'test-operation-id',
  TMP_ASSISTANT_ID: 'tmp-assistant-id',
} as const;

// Helper to reset test environment
const resetTestEnvironment = () => {
  vi.clearAllMocks();
  useChatStore.setState(
    {
      operations: {},
      messageOperationMap: {},
      messagesMap: {},
      dbMessagesMap: {},
    },
    false,
  );
};

// Helper to create streaming context
const createStreamingContext = (overrides: any = {}) => ({
  assistantId: '',
  content: '',
  reasoning: '',
  tmpAssistantId: TEST_IDS.TMP_ASSISTANT_ID,
  ...overrides,
});

// Helper to create stream_start event
const createStreamStartEvent = (overrides = {}): StreamEvent => ({
  type: 'stream_start',
  timestamp: Date.now(),
  operationId: TEST_IDS.OPERATION_ID,
  data: {
    assistantMessage: {
      id: TEST_IDS.ASSISTANT_MESSAGE_ID,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  },
  ...overrides,
});

describe('runAgent actions', () => {
  beforeEach(() => {
    resetTestEnvironment();

    // Setup default mocks for store methods
    act(() => {
      useChatStore.setState({
        internal_dispatchMessage: vi.fn(),
        internal_toggleMessageLoading: vi.fn(),
        optimisticUpdateMessageContent: vi.fn(),
        refreshMessages: vi.fn(),
        updateOperationMetadata: vi.fn(),
        operations: {
          [TEST_IDS.OPERATION_ID]: {
            id: TEST_IDS.OPERATION_ID,
            type: 'groupAgentGenerate',
            status: 'running',
            context: {},
            abortController: new AbortController(),
            metadata: {
              startTime: Date.now(),
              lastEventId: '0',
              stepCount: 0,
            },
          },
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('internal_handleAgentStreamEvent', () => {
    describe('stream_start event', () => {
      it('should skip message creation/deletion when assistantId is already set (Group Chat flow)', async () => {
        const { result } = renderHook(() => useChatStore());

        // Context with assistantId already set (Group Chat scenario)
        const context = createStreamingContext({
          assistantId: TEST_IDS.ASSISTANT_MESSAGE_ID, // Already set from backend response
        });

        const event = createStreamStartEvent();

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            TEST_IDS.OPERATION_ID,
            event,
            context,
          );
        });

        // Should NOT call dispatchMessage for delete or create
        expect(result.current.internal_dispatchMessage).not.toHaveBeenCalled();

        // assistantId should remain unchanged
        expect(context.assistantId).toBe(TEST_IDS.ASSISTANT_MESSAGE_ID);
      });

      it('should delete temp message and create new message when assistantId is empty (normal Agent flow)', async () => {
        const { result } = renderHook(() => useChatStore());

        // Context with empty assistantId (normal Agent scenario)
        const context = createStreamingContext({
          assistantId: '', // Empty, waiting for stream_start
        });

        const event = createStreamStartEvent();

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            TEST_IDS.OPERATION_ID,
            event,
            context,
          );
        });

        // Should call dispatchMessage for deleteMessage
        expect(result.current.internal_dispatchMessage).toHaveBeenCalledWith({
          id: TEST_IDS.TMP_ASSISTANT_ID,
          type: 'deleteMessage',
        });

        // Should call dispatchMessage for createMessage
        expect(result.current.internal_dispatchMessage).toHaveBeenCalledWith({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'createMessage',
          value: expect.objectContaining({
            id: TEST_IDS.ASSISTANT_MESSAGE_ID,
            role: 'assistant',
          }),
        });

        // assistantId should be updated from event
        expect(context.assistantId).toBe(TEST_IDS.ASSISTANT_MESSAGE_ID);
      });

      it('should update assistantId in context from event data when empty', async () => {
        const { result } = renderHook(() => useChatStore());

        const context = createStreamingContext({
          assistantId: '',
        });

        const customAssistantId = 'custom-assistant-id-from-event';
        const event = createStreamStartEvent({
          data: {
            assistantMessage: {
              id: customAssistantId,
              role: 'assistant',
              content: '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        });

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            TEST_IDS.OPERATION_ID,
            event,
            context,
          );
        });

        // assistantId should be updated to the ID from event
        expect(context.assistantId).toBe(customAssistantId);
      });

      it('should NOT update assistantId when it is already set', async () => {
        const { result } = renderHook(() => useChatStore());

        const originalAssistantId = 'original-assistant-id';
        const context = createStreamingContext({
          assistantId: originalAssistantId,
        });

        const event = createStreamStartEvent({
          data: {
            assistantMessage: {
              id: 'different-assistant-id',
              role: 'assistant',
              content: '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        });

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            TEST_IDS.OPERATION_ID,
            event,
            context,
          );
        });

        // assistantId should remain unchanged
        expect(context.assistantId).toBe(originalAssistantId);
      });
    });

    describe('stream_chunk event', () => {
      it('should update content correctly using existing assistantId', async () => {
        const { result } = renderHook(() => useChatStore());

        const context = createStreamingContext({
          assistantId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          content: 'Hello ',
        });

        const event: StreamEvent = {
          type: 'stream_chunk',
          timestamp: Date.now(),
          operationId: TEST_IDS.OPERATION_ID,
          data: {
            chunkType: 'text',
            content: 'World',
          },
        };

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            TEST_IDS.OPERATION_ID,
            event,
            context,
          );
        });

        // Should update message with accumulated content
        expect(result.current.internal_dispatchMessage).toHaveBeenCalledWith({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: { content: 'Hello World' },
        });

        // Context content should be accumulated
        expect(context.content).toBe('Hello World');
      });

      it('should use tmpAssistantId when assistantId is not yet set', async () => {
        const { result } = renderHook(() => useChatStore());

        const context = createStreamingContext({
          assistantId: '', // Not yet set
          content: '',
        });

        const event: StreamEvent = {
          type: 'stream_chunk',
          timestamp: Date.now(),
          operationId: TEST_IDS.OPERATION_ID,
          data: {
            chunkType: 'text',
            content: 'Hello',
          },
        };

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            TEST_IDS.OPERATION_ID,
            event,
            context,
          );
        });

        // Should use tmpAssistantId as fallback
        expect(result.current.internal_dispatchMessage).toHaveBeenCalledWith({
          id: TEST_IDS.TMP_ASSISTANT_ID,
          type: 'updateMessage',
          value: { content: 'Hello' },
        });
      });
    });

    describe('operation validation', () => {
      it('should ignore events when operation is not found', async () => {
        const { result } = renderHook(() => useChatStore());

        // Clear operations so no operation is found
        act(() => {
          useChatStore.setState({ operations: {} });
        });

        const context = createStreamingContext();
        const event = createStreamStartEvent();

        await act(async () => {
          await result.current.internal_handleAgentStreamEvent(
            'non-existent-operation',
            event,
            context,
          );
        });

        // Should not process event
        expect(result.current.internal_dispatchMessage).not.toHaveBeenCalled();
      });
    });
  });
});
