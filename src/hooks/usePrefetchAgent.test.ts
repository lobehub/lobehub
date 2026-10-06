import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefetchAgent } from './usePrefetchAgent';

const mocks = vi.hoisted(() => ({ prefetchAgentConfig: vi.fn() }));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({ prefetchAgentConfig: mocks.prefetchAgentConfig }),
}));

describe('usePrefetchAgent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('warms the agent config replica', () => {
    const { result } = renderHook(() => usePrefetchAgent());

    act(() => result.current('agent-1'));

    expect(mocks.prefetchAgentConfig).toHaveBeenCalledWith('agent-1');
  });

  it('ignores an empty id', () => {
    const { result } = renderHook(() => usePrefetchAgent());

    act(() => result.current(''));

    expect(mocks.prefetchAgentConfig).not.toHaveBeenCalled();
  });
});
