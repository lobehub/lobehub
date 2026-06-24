import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { workspaceHomeRouteMeta } from './routeMeta';

const mocks = vi.hoisted(() => ({
  workspaces: [] as Array<{ avatar?: string | null; id: string; name: string; slug: string }>,
}));

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => mocks.workspaces,
}));

describe('workspaceHomeRouteMeta', () => {
  it('uses the workspace avatar and name for the workspace home tab', () => {
    mocks.workspaces = [
      { avatar: 'https://example.com/avatar.png', id: 'ws-1', name: 'Acme', slug: 'acme' },
    ];

    const { result } = renderHook(() =>
      workspaceHomeRouteMeta.useDynamicMeta?.({ workspaceSlug: 'acme' }),
    );

    expect(result.current).toEqual({
      avatar: 'https://example.com/avatar.png',
      title: 'Acme',
    });
  });

  it('uses the workspace name as the avatar placeholder source when no avatar is set', () => {
    mocks.workspaces = [{ avatar: null, id: 'ws-1', name: 'Acme', slug: 'acme' }];

    const { result } = renderHook(() =>
      workspaceHomeRouteMeta.useDynamicMeta?.({ workspaceSlug: 'acme' }),
    );

    expect(result.current).toEqual({
      avatar: 'Acme',
      title: 'Acme',
    });
  });

  it('returns no dynamic meta while the workspace slug is unresolved', () => {
    mocks.workspaces = [];

    const { result } = renderHook(() =>
      workspaceHomeRouteMeta.useDynamicMeta?.({ workspaceSlug: 'acme' }),
    );

    expect(result.current).toEqual({});
  });
});
