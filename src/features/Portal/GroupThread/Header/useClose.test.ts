import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGroupThreadClose } from './useClose';

const mocks = vi.hoisted(() => ({ clearPortalStack: vi.fn(), setState: vi.fn() }));

vi.mock('@/store/agentGroup', () => ({ useAgentGroupStore: { setState: mocks.setState } }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ clearPortalStack: mocks.clearPortalStack }),
}));

describe('useGroupThreadClose', () => {
  beforeEach(() => vi.clearAllMocks());

  // Regression: the hand-rolled header ignored the host's `onClose`.
  it('forgets the DM member, then closes through the host', () => {
    const hostClose = vi.fn();
    renderHook(() => useGroupThreadClose(hostClose)).result.current();

    expect(mocks.setState).toHaveBeenCalledWith({ activeThreadAgentId: '' });
    expect(hostClose).toHaveBeenCalledOnce();
    expect(mocks.clearPortalStack).not.toHaveBeenCalled();
  });

  it('closes the whole portal when the host supplies no close', () => {
    renderHook(() => useGroupThreadClose()).result.current();

    expect(mocks.setState).toHaveBeenCalledWith({ activeThreadAgentId: '' });
    expect(mocks.clearPortalStack).toHaveBeenCalledOnce();
  });
});
