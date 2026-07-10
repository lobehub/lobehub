import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

const mocks = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; slug: string }>,
}));

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => mocks.workspaces,
}));

describe('useRouteWorkspaceId', () => {
  it('resolves personal scope when the route has no workspace slug', () => {
    const { result } = renderHook(() => useRouteWorkspaceId({}));
    expect(result.current).toBeNull();
  });

  it('resolves workspace id from the route workspace slug', () => {
    mocks.workspaces = [{ id: 'ws-1', slug: 'acme' }];

    const { result } = renderHook(() => useRouteWorkspaceId({ workspaceSlug: 'acme' }));

    expect(result.current).toBe('ws-1');
  });

  it('returns unresolved scope for an unknown workspace slug', () => {
    mocks.workspaces = [];

    const { result } = renderHook(() => useRouteWorkspaceId({ workspaceSlug: 'acme' }));

    expect(result.current).toBeUndefined();
  });
});

describe('matchesRouteWorkspace', () => {
  it('matches personal items only in personal scope', () => {
    expect(matchesRouteWorkspace(null, null)).toBe(true);
    expect(matchesRouteWorkspace(undefined, null)).toBe(true);
    expect(matchesRouteWorkspace('ws-1', null)).toBe(false);
  });

  it('matches workspace items only by workspace id', () => {
    expect(matchesRouteWorkspace('ws-1', 'ws-1')).toBe(true);
    expect(matchesRouteWorkspace('ws-2', 'ws-1')).toBe(false);
  });

  it('rejects all items while the route workspace is unresolved', () => {
    expect(matchesRouteWorkspace(null, undefined)).toBe(false);
    expect(matchesRouteWorkspace('ws-1', undefined)).toBe(false);
  });
});
