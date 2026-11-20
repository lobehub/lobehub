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
        avatarKind: 'workspace',
        backgroundColor: undefined,
        title: 'Acme',
      });
    });
  });

  // The tab draws the workspace mark seeded from the title, so no name string
  // poses as the avatar.
  it('marks the tab as a workspace without an avatar when no avatar is set', async () => {
    mocks.workspaces = [{ avatar: null, id: 'ws-1', name: 'Acme', slug: 'acme' }];

    const onResolve = renderDynamicMeta('acme');

    await waitFor(() => {
      expect(onResolve).toHaveBeenLastCalledWith({
        avatar: null,
        avatarKind: 'workspace',
        backgroundColor: undefined,
        title: 'Acme',
      });
    });
  });

  it('renders no outlet skeleton — Home never loads inside the outlet', () => {
    const Skeleton = workspaceHomeRouteMeta.Skeleton!;
    const { container } = render(<Skeleton />);

    expect(container).toBeEmptyDOMElement();
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
