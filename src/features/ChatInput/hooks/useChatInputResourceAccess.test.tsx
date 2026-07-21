import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from '../store';
import { useChatInputResourceAccess } from './useChatInputResourceAccess';

// Isolate the test to the ChatInput-store access behavior: the peripheral
// stores/permission hooks are stubbed so the only variable is whether a
// ChatInput store Provider is present.
const useResourceAccessMock = vi.fn(() => ({
  canEditResource: true,
  canManageResource: true,
  canUseResource: true,
  isAccessResolved: true,
  isLoading: false,
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: (...args: unknown[]) => useResourceAccessMock(...(args as [])),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/store/agent', () => ({ useAgentStore: () => undefined }));
vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { inboxAgentId: () => undefined },
}));
vi.mock('@/store/agentGroup', () => ({ useAgentGroupStore: () => undefined }));
vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: { getGroupById: () => () => undefined },
}));

describe('useChatInputResourceAccess', () => {
  afterEach(() => {
    useResourceAccessMock.mockClear();
  });

  // Regression: the image/video generation prompt reuses ChatInput's <Action>,
  // which reaches this hook, without wrapping it in a ChatInput store Provider.
  // Reading the zustand-utils context store directly threw
  // "...used zustand provider as an ancestor." and crashed the whole page.
  it('does not throw when rendered without a ChatInput store Provider', () => {
    const { result } = renderHook(() => useChatInputResourceAccess());

    expect(result.current.canUseResource).toBe(true);
    expect(result.current.isGroupContext).toBe(false);
    // No bound agent to gate when there is no store.
    expect(useResourceAccessMock).toHaveBeenLastCalledWith('agent', undefined);
  });

  it('reads the bound agentId from the store when a Provider is present', () => {
    const store = createStore({ agentId: 'agent-1' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );

    const { result } = renderHook(() => useChatInputResourceAccess(), { wrapper });

    expect(result.current.canUseResource).toBe(true);
    expect(useResourceAccessMock).toHaveBeenLastCalledWith('agent', 'agent-1');
  });
});
