import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { homeService } from '@/services/home';
import { useHomeStore } from '@/store/home';
import { withSWR } from '~test-utils';

import { initialAgentListState } from './initialState';

beforeEach(() => {
  useHomeStore.setState({
    agentSearchKeywords: initialAgentListState.agentSearchKeywords,
    isAgentSearching: initialAgentListState.isAgentSearching,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAgentListSlice', () => {
  describe('updateAgentSearchKeywords', () => {
    it('should enter search mode when keyword has content', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.updateAgentSearchKeywords('agent');
      });

      expect(useHomeStore.getState().agentSearchKeywords).toBe('agent');
      expect(useHomeStore.getState().isAgentSearching).toBe(true);
    });

    it('should leave search mode when keyword is blank', () => {
      useHomeStore.setState({
        agentSearchKeywords: 'agent',
        isAgentSearching: true,
      });

      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.updateAgentSearchKeywords('   ');
      });

      expect(useHomeStore.getState().agentSearchKeywords).toBe('   ');
      expect(useHomeStore.getState().isAgentSearching).toBe(false);
    });
  });

  describe('useSearchAgents', () => {
    it('should trim keyword before searching agents', async () => {
      vi.spyOn(homeService, 'searchAgents').mockResolvedValueOnce([]);

      const { result } = renderHook(() => useHomeStore().useSearchAgents('  agent  '), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual([]));
      expect(homeService.searchAgents).toHaveBeenCalledWith('agent');
    });

    it('should not call search service for blank keyword', async () => {
      const spy = vi.spyOn(homeService, 'searchAgents');

      const { result } = renderHook(() => useHomeStore().useSearchAgents('   '), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual([]));
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
