import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat/store';

describe('Operation Actions', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('completeOperation', () => {
    it('should mark operation as completed with correct metadata', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      act(() => {
        result.current.completeOperation(operationId!);
      });

      const operation = result.current.operations[operationId!];

      expect(operation.status).toBe('completed');
      expect(operation.metadata.endTime).toBeDefined();
      expect(operation.metadata.duration).toBeDefined();
      expect(operation.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('keeps status completed and does not throw when completed again', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      act(() => {
        result.current.completeOperation(operationId!);
      });

      expect(() => {
        act(() => {
          result.current.completeOperation(operationId!);
        });
      }).not.toThrow();

      expect(result.current.operations[operationId!].status).toBe('completed');
    });

    it('keeps a cancelled operation cancelled instead of flipping it to completed', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      act(() => {
        result.current.cancelOperation(operationId!, 'User cancelled');
      });

      act(() => {
        result.current.completeOperation(operationId!);
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });
  });
});
