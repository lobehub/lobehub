import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { workspaceHomeRouteMeta } from './routeMeta';

const mocks = vi.hoisted(() => ({
  workspaces: [] as Array<{ avatar?: string | null; id: string; name: string; slug: string }>,
}));

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => mocks.workspaces,
}));

describe('workspaceHomeRouteMeta', () => {
  afterEach(() => {
    cleanup();
    mocks.workspaces = [];
  });

  const renderDynamicMeta = (workspaceSlug: string) => {
    const DynamicMeta = workspaceHomeRouteMeta.DynamicMeta!;
    const onResolve = vi.fn();

    render(<DynamicMeta params={{ workspaceSlug }} onResolve={onResolve} />);

    return onResolve;
  };

  it('uses the workspace avatar and name for the workspace home tab', async () => {
    mocks.workspaces = [
      { avatar: 'https://example.com/avatar.png', id: 'ws-1', name: 'Acme', slug: 'acme' },
    ];

    const onResolve = renderDynamicMeta('acme');

    await waitFor(() => {
      expect(onResolve).toHaveBeenLastCalledWith({
        avatar: 'https://example.com/avatar.png',
        backgroundColor: undefined,
        title: 'Acme',
      });
    });
  });

  it('uses the workspace name as the avatar placeholder source when no avatar is set', async () => {
    mocks.workspaces = [{ avatar: null, id: 'ws-1', name: 'Acme', slug: 'acme' }];

    const onResolve = renderDynamicMeta('acme');

    await waitFor(() => {
      expect(onResolve).toHaveBeenLastCalledWith({
        avatar: 'Acme',
        backgroundColor: undefined,
        title: 'Acme',
      });
    });
  });

  it('returns no dynamic meta while the workspace slug is unresolved', async () => {
    const onResolve = renderDynamicMeta('acme');

    await waitFor(() => {
      expect(onResolve).toHaveBeenLastCalledWith({
        avatar: undefined,
        backgroundColor: undefined,
        title: undefined,
      });
    });
  });
});
