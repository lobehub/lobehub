import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';

import { useOperationState } from './useOperationState';

vi.mock('zustand/traditional');

describe('useOperationState', () => {
  const TEST_CONTEXT = {
    agentId: 'test-agent-id',
    topicId: 'test-topic-id',
    threadId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useChatStore.setState({
        operations: {},
        operationsByContext: {},
        operationsByMessage: {},
        toolCallingStreamIds: {},
      });
    });
  });

  describe('getMessageOperationState', () => {
    describe('isGenerating', () => {
      it('should return true when execAgentRuntime operation is running', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-1': {
                id: 'op-1',
                type: 'execAgentRuntime',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
            },
            operationsByMessage: {
              [messageId]: ['op-1'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isGenerating).toBe(true);
      });

      it('should return true when execServerAgentRuntime operation is running (Group Chat)', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-1': {
                id: 'op-1',
                type: 'execServerAgentRuntime',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
            },
            operationsByMessage: {
              [messageId]: ['op-1'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isGenerating).toBe(true);
      });

      it('should return false when operation is completed', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-1': {
                id: 'op-1',
                type: 'execServerAgentRuntime',
                status: 'completed',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
            },
            operationsByMessage: {
              [messageId]: ['op-1'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isGenerating).toBe(false);
      });

      it('should return false when no operations exist for the message', () => {
        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState('non-existent-message');
        expect(state.isGenerating).toBe(false);
      });

      it('should return true when message has multiple operations with at least one running execServerAgentRuntime', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-exec': {
                id: 'op-exec',
                type: 'execServerAgentRuntime',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
              'op-stream': {
                id: 'op-stream',
                type: 'groupAgentStream',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
                parentOperationId: 'op-exec',
              },
            },
            operationsByMessage: {
              [messageId]: ['op-exec', 'op-stream'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isGenerating).toBe(true);
      });

      it('should detect isGenerating for all AI_RUNTIME_OPERATION_TYPES', () => {
        // Verify the constant is used correctly by testing all types in it
        for (const opType of AI_RUNTIME_OPERATION_TYPES) {
          const messageId = `test-message-${opType}`;

          act(() => {
            useChatStore.setState({
              operations: {
                'op-1': {
                  id: 'op-1',
                  type: opType,
                  status: 'running',
                  context: { messageId },
                  abortController: new AbortController(),
                  metadata: { startTime: Date.now() },
                },
              },
              operationsByMessage: {
                [messageId]: ['op-1'],
              },
            });
          });

          const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

          const state = result.current.getMessageOperationState(messageId);
          expect(state.isGenerating).toBe(true);
        }
      });
    });

    describe('other states', () => {
      it('should return isCreating true when sendMessage operation is running', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-1': {
                id: 'op-1',
                type: 'sendMessage',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
            },
            operationsByMessage: {
              [messageId]: ['op-1'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isCreating).toBe(true);
      });

      it('should return isContinuing true when continue operation is running', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-1': {
                id: 'op-1',
                type: 'continue',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
            },
            operationsByMessage: {
              [messageId]: ['op-1'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isContinuing).toBe(true);
      });

      it('should return isRegenerating true when regenerate operation is running', () => {
        const messageId = 'test-message-id';

        act(() => {
          useChatStore.setState({
            operations: {
              'op-1': {
                id: 'op-1',
                type: 'regenerate',
                status: 'running',
                context: { messageId },
                abortController: new AbortController(),
                metadata: { startTime: Date.now() },
              },
            },
            operationsByMessage: {
              [messageId]: ['op-1'],
            },
          });
        });

        const { result } = renderHook(() => useOperationState(TEST_CONTEXT));

        const state = result.current.getMessageOperationState(messageId);
        expect(state.isRegenerating).toBe(true);
      });
    });
  });
});
