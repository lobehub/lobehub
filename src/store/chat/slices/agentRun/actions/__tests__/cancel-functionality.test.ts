import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';

describe('Cancel send message functionality tests', () => {
  describe('cancelSendMessageInServer', () => {
    it('should be able to call cancel method normally', () => {
      const { result } = renderHook(() => useChatStore());

      // Initial state setup
      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-1',
          activeTopicId: 'topic-1',
          operations: {},
          operationsByContext: {},
        });
      });

      // Test method exists
      expect(typeof result.current.cancelSendMessageInServer).toBe('function');

      // Test method can be called safely
      expect(() => {
        act(() => {
          result.current.cancelSendMessageInServer();
        });
      }).not.toThrow();
    });

    it('should cancel running sendMessage operations', () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'session-1';
      const topicId = 'topic-1';

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
        });
      });

      // Start a sendMessage operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId, topicId },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Cancel the operation
      act(() => {
        result.current.cancelSendMessageInServer();
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });

    it('should restore editor state when cancelling', () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'session-1';
      const topicId = 'topic-1';
      const mockEditorState = { content: 'test message' };

      // Mock editor
      const mockEditor = {
        setJSONState: vi.fn(),
        getJSONState: vi.fn().mockReturnValue(mockEditorState),
      };

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          mainInputEditor: mockEditor as any,
        });
      });

      // Create operation with editor state
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId, topicId },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputEditorTempState: mockEditorState,
        });
      });

      // Cancel
      act(() => {
        result.current.cancelSendMessageInServer();
      });

      // Verify editor state was restored
      expect(mockEditor.setJSONState).toHaveBeenCalledWith(mockEditorState);
    });

    it('should be able to call with specified topic ID', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-1',
          operations: {},
          operationsByContext: {},
        });
      });

      expect(() => {
        act(() => {
          result.current.cancelSendMessageInServer('topic-2');
        });
      }).not.toThrow();
    });
  });

  describe('clearSendMessageError', () => {
    it('should be able to call clear error method normally', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-1',
          activeTopicId: 'topic-1',
          operations: {},
          operationsByContext: {},
        });
      });

      expect(typeof result.current.clearSendMessageError).toBe('function');

      expect(() => {
        act(() => {
          result.current.clearSendMessageError();
        });
      }).not.toThrow();
    });

    it('should clear error messages from sendMessage operations', () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'session-1';
      const topicId = 'topic-1';

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
        });
      });

      // Create operation with error
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId, topicId },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputSendErrorMsg: 'Test error',
        });
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBe('Test error');

      // Clear error
      act(() => {
        result.current.clearSendMessageError();
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBeUndefined();
    });
  });

  describe('Operation system', () => {
    it('should have operation management methods', () => {
      const { result } = renderHook(() => useChatStore());

      expect(typeof result.current.startOperation).toBe('function');
      expect(typeof result.current.cancelOperation).toBe('function');
      expect(typeof result.current.updateOperationMetadata).toBe('function');
    });

    it('should track operations by context', () => {
      const { result } = renderHook(() => useChatStore());

      const sessionId = 'session-1';
      const topicId = 'topic-1';

      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: sessionId, topicId },
        });
        operationId = res.operationId;
      });

      const contextKey = messageMapKey({ agentId: sessionId, topicId });
      expect(result.current.operationsByContext[contextKey]).toContain(operationId!);
    });
  });
});
