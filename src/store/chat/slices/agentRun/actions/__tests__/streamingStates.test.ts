import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../../../../store';
import { TEST_IDS } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

beforeEach(() => {
  resetTestEnvironment();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StreamingStates actions', () => {
  describe('internal_toggleToolCallingStreaming', () => {
    it('should track tool calling stream status', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleToolCallingStreaming(TEST_IDS.MESSAGE_ID, [true]);
      });

      expect(result.current.toolCallingStreamIds[TEST_IDS.MESSAGE_ID]).toEqual([true]);
    });

    it('should clear tool calling stream status', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleToolCallingStreaming(TEST_IDS.MESSAGE_ID, [true]);
        result.current.internal_toggleToolCallingStreaming(TEST_IDS.MESSAGE_ID, undefined);
      });

      expect(result.current.toolCallingStreamIds[TEST_IDS.MESSAGE_ID]).toBeUndefined();
    });
  });

  describe('internal_toggleSearchWorkflow', () => {
    it('should enable search workflow loading state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleSearchWorkflow(true, TEST_IDS.MESSAGE_ID);
      });

      const state = useChatStore.getState();
      expect(state.searchWorkflowLoadingIds).toEqual([TEST_IDS.MESSAGE_ID]);
    });

    it('should disable search workflow loading state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleSearchWorkflow(true, TEST_IDS.MESSAGE_ID);
        result.current.internal_toggleSearchWorkflow(false, TEST_IDS.MESSAGE_ID);
      });

      const state = useChatStore.getState();
      expect(state.searchWorkflowLoadingIds).toEqual([]);
    });
  });
});
