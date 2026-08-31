import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';

import { usePrefetchAgent } from './usePrefetchAgent';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));
vi.mock('@/libs/swr/useCacheScope', () => ({ getCacheScope: () => 'user-1:workspace-1' }));
vi.mock('@/services/agent', () => ({
  agentService: { getAgentConfigById: vi.fn().mockResolvedValue({ id: 'agent-1' }) },
}));

describe('usePrefetchAgent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes one unaugmented identity-scoped key to the scoped mutate wrapper', () => {
    const { result } = renderHook(() => usePrefetchAgent());

    act(() => result.current('agent-1'));

    expect(mutate).toHaveBeenCalledWith(
      agentConfigKeys.config('agent-1', 'user-1:workspace-1'),
      expect.any(Promise),
      { revalidate: false },
    );
    expect(agentService.getAgentConfigById).toHaveBeenCalledWith('agent-1');
  });
});
