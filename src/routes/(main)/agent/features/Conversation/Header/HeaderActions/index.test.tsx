import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeaderActions from './index';

const mocks = vi.hoisted(() => ({
  canShare: true,
  enableBusinessFeatures: true,
  openShareModal: vi.fn(),
  workspaceId: null as string | null,
}));

vi.mock('./useMenu', () => ({
  useMenu: ({ share }: { share?: { disabled?: boolean; onClick: () => void } } = {}) => ({
    menuHeader: <div data-testid={'topic-info-header'} />,
    menuItems: share
      ? [{ disabled: share.disabled, key: 'share', label: 'Share', onClick: share.onClick }]
      : [],
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));

vi.mock('@/features/Conversation/useAgentContext', () => ({
  useAgentContext: () => ({ agentId: 'agent-1', topicId: 'topic-1' }),
}));

vi.mock('@/features/ShareModal', () => ({
  useShareModal: () => ({ openShareModal: mocks.openShareModal }),
}));

vi.mock('@/features/SharePopover/lazy', () => ({
  LazySharePopover: ({ open }: { children?: ReactNode; open?: boolean }) => (
    <div data-open={String(!!open)} data-testid={'share-popover'} />
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canShare }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { enableBusinessFeatures: boolean }) => unknown) =>
    selector({ enableBusinessFeatures: mocks.enableBusinessFeatures }),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: (s: { enableBusinessFeatures: boolean }) => s.enableBusinessFeatures,
  },
}));

describe('Conversation header actions', () => {
  beforeEach(() => {
    mocks.canShare = true;
    mocks.enableBusinessFeatures = true;
    mocks.openShareModal.mockClear();
    mocks.workspaceId = null;
  });

  it('renders the overflow actions button', () => {
    render(<HeaderActions />);

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('passes the topic info header to the dropdown', async () => {
    render(<HeaderActions />);

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByTestId('topic-info-header')).toBeInTheDocument();
  });

  it('keeps Share out of the menu in personal scope, where the header has its own button', async () => {
    render(<HeaderActions />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByTestId('topic-info-header');

    expect(screen.queryByText('Share')).toBeNull();
    expect(screen.queryByTestId('share-popover')).toBeNull();
  });

  it('opens the share popover from the menu inside a workspace once the menu has closed', async () => {
    mocks.workspaceId = 'ws-1';
    render(<HeaderActions />);

    expect(screen.getByTestId('share-popover')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByText('Share'));

    await vi.waitFor(() =>
      expect(screen.getByTestId('share-popover')).toHaveAttribute('data-open', 'true'),
    );
    expect(mocks.openShareModal).not.toHaveBeenCalled();
  });

  it('goes straight to the export modal when link sharing is unavailable', async () => {
    mocks.workspaceId = 'ws-1';
    mocks.enableBusinessFeatures = false;
    render(<HeaderActions />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByText('Share'));

    expect(mocks.openShareModal).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('share-popover')).toBeNull();
  });
});
