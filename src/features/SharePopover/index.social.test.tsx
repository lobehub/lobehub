/**
 * @vitest-environment happy-dom
 */
import type * as BaseUI from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharePopoverContent } from './index';

const mocks = vi.hoisted(() => ({
  canPublishLink: true,
  close: vi.fn(),
  share: undefined as undefined | { id: string; visibility: 'link' | 'private' },
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    QRCode: () => <div data-testid={'qrcode'} />,
    usePopoverContext: () => ({ close: mocks.close }),
  };
});

vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));
vi.mock('@/hooks/useTopicSharePermission', () => ({
  useTopicSharePermission: () => ({
    allowed: mocks.canPublishLink,
    reason: 'only the creator can publish',
  }),
}));
vi.mock('./useTopicShare', () => ({
  useTopicShare: () => ({
    error: undefined,
    isLoading: false,
    retry: vi.fn(),
    setVisibility: vi.fn(),
    shareInfo: mocks.share,
    visibility: mocks.share?.visibility ?? 'private',
  }),
}));

const tiles = () => [...document.querySelectorAll<HTMLButtonElement>('button[data-platform]')];

describe('SharePopover social share section', () => {
  beforeEach(() => {
    mocks.canPublishLink = true;
    mocks.share = undefined;
    mocks.close.mockReset();
  });

  it('disables social share and asks to enable link sharing when there is no share id', () => {
    render(<SharePopoverContent topicId={'tpc_1'} />);

    expect(screen.getByText('shareModal.social.title')).toBeInTheDocument();
    expect(screen.getByText('shareModal.social.disabledHint')).toBeInTheDocument();
    expect(tiles()).toHaveLength(4);
    for (const tile of tiles()) expect(tile).toBeDisabled();
  });

  it('stays disabled while a share record exists but is private', () => {
    mocks.share = { id: 'abc123', visibility: 'private' };
    render(<SharePopoverContent topicId={'tpc_1'} />);

    for (const tile of tiles()) expect(tile).toBeDisabled();
  });

  it('shows the publish restriction instead when the user may not publish a link', () => {
    mocks.canPublishLink = false;
    render(<SharePopoverContent topicId={'tpc_1'} />);

    expect(screen.getAllByText('only the creator can publish')).toHaveLength(1);
    expect(screen.queryByText('shareModal.social.disabledHint')).not.toBeInTheDocument();
    for (const tile of tiles()) expect(tile).toBeDisabled();
  });

  it('enables all four channels once the topic is shared by link', () => {
    mocks.share = { id: 'abc123', visibility: 'link' };
    render(<SharePopoverContent topicId={'tpc_1'} />);

    expect(screen.queryByText('shareModal.social.disabledHint')).not.toBeInTheDocument();
    for (const tile of tiles()) expect(tile).toBeEnabled();
  });

  it('closes the popover when a channel sends the user to another site', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mocks.share = { id: 'abc123', visibility: 'link' };
    render(<SharePopoverContent topicId={'tpc_1'} />);

    fireEvent.click(document.querySelector<HTMLButtonElement>('button[data-platform="x"]')!);

    expect(open).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
