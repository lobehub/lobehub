import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentRoutePath } from './useAgentRoutePath';

const mocks = vi.hoisted(() => ({ activeWorkspaceSlug: null as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

const wrapperAt = (pathname: string, basename?: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(MemoryRouter, { basename, initialEntries: [pathname] }, children);
  };

describe('useAgentRoutePath', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
  });

  it('returns the agent home when no segment is given', () => {
    const { result } = renderHook(() => useAgentRoutePath('agent-1'), {
      wrapper: wrapperAt('/agent/agent-1/goal/goal-1'),
    });

    expect(result.current()).toBe('/agent/agent-1');
  });

  it('builds a sub-page path under the agent', () => {
    const { result } = renderHook(() => useAgentRoutePath('agent-1'), {
      wrapper: wrapperAt('/agent/agent-1/goal/goal-1'),
    });

    expect(result.current('goals')).toBe('/agent/agent-1/goals');
  });

  it('keeps the active workspace prefix on a sub-page path', () => {
    mocks.activeWorkspaceSlug = 'team';

    const { result } = renderHook(() => useAgentRoutePath('agent-1'), {
      wrapper: wrapperAt('/team/agent/agent-1/goal/goal-1'),
    });

    expect(result.current('goals')).toBe('/team/agent/agent-1/goals');
  });

  it('keeps a non-workspace route prefix on a sub-page path', () => {
    const { result } = renderHook(() => useAgentRoutePath('agent-1'), {
      wrapper: wrapperAt('/chat/agent/agent-1/goal/goal-1'),
    });

    expect(result.current('goals')).toBe('/chat/agent/agent-1/goals');
  });
});
