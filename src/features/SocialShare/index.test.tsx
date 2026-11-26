/**
 * @vitest-environment happy-dom
 */
import type * as BaseUI from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SocialShare from '.';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  isMobile: false,
  toastSuccess: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    QRCode: ({ value, 'aria-label': label }: { 'aria-label'?: string; 'value': string }) => (
      <div aria-label={label} data-testid={'qrcode'} data-value={value} />
    ),
    copyToClipboard: mocks.copyToClipboard,
    toast: { ...actual.toast, success: mocks.toastSuccess },
  };
});

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.isMobile }));

const shareUrl = 'https://app.lobehub.com/share/t/abc123';

const tile = (platform: string) =>
  document.querySelector<HTMLButtonElement>(`button[data-platform="${platform}"]`)!;

describe('SocialShare', () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockReset().mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.isMobile = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders four platform entries', () => {
    render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

    expect(screen.getByText('shareModal.social.title')).toBeInTheDocument();
    for (const platform of ['x', 'weibo', 'instagram', 'wechat']) {
      expect(tile(platform)).toBeEnabled();
    }
  });

  it('disables every entry and shows the hint without a share link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <SocialShare disabledHint={'turn on link sharing'} shareUrl={undefined} title={'My topic'} />,
    );

    expect(screen.getByText('turn on link sharing')).toBeInTheDocument();
    for (const platform of ['x', 'weibo', 'instagram', 'wechat']) {
      expect(tile(platform)).toBeDisabled();
      fireEvent.click(tile(platform));
    }
    expect(open).not.toHaveBeenCalled();
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('qrcode')).not.toBeInTheDocument();
  });

  it('opens the X intent in a new tab with the copy and link prefilled', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

    fireEvent.click(tile('x'));

    const [href, target, features] = open.mock.calls[0];
    expect(String(href)).toMatch(/^https:\/\/x\.com\/intent\/post\?/);
    expect(new URL(String(href)).searchParams.get('text')).toBe(
      `My topic via LobeHub\n${shareUrl}`,
    );
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
  });

  it('opens the Weibo share page in a new tab with the encoded link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

    fireEvent.click(tile('weibo'));

    const href = String(open.mock.calls[0][0]);
    expect(href).toMatch(/^https:\/\/service\.weibo\.com\/share\/share\.php\?/);
    expect(href).toContain(`url=${encodeURIComponent(shareUrl)}`);
    expect(new URL(href).searchParams.get('title')).toContain('My topic');
  });

  it('copies the caption for Instagram and shows how to post it', async () => {
    render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

    fireEvent.click(tile('instagram'));

    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1));
    const copied = mocks.copyToClipboard.mock.calls[0][0] as string;
    expect(copied).toContain('My topic');
    expect(copied).toContain('via LobeHub');
    expect(copied.endsWith(shareUrl)).toBe(true);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('shareModal.social.instagram.copied');

    const panel = screen.getByTestId('social-instagram-panel');
    expect(panel).toHaveTextContent('shareModal.social.instagram.hint');
    expect(panel).toHaveTextContent(shareUrl);
    expect(tile('instagram')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('shareModal.social.instagram.open').closest('a')).toHaveAttribute(
      'href',
      'https://www.instagram.com/',
    );
  });

  it('uses the system share sheet for Instagram on mobile', async () => {
    mocks.isMobile = true;
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });

    render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);
    fireEvent.click(tile('instagram'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();

    delete (navigator as any).share;
    delete (navigator as any).canShare;
  });

  it('shows a QR code of the share link for WeChat Moments, with copy actions', async () => {
    render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

    fireEvent.click(tile('wechat'));

    const panel = screen.getByTestId('social-wechat-panel');
    expect(screen.getByTestId('qrcode')).toHaveAttribute('data-value', shareUrl);
    expect(panel).toHaveTextContent('shareModal.social.wechat.hint');

    fireEvent.click(screen.getByText('shareModal.copyLink'));
    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledWith(shareUrl));

    fireEvent.click(screen.getByText('shareModal.social.copyText'));
    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledTimes(2));
    expect(mocks.copyToClipboard.mock.calls[1][0]).toContain('via LobeHub');

    // Pressing it again folds the panel.
    fireEvent.click(tile('wechat'));
    expect(screen.queryByTestId('qrcode')).not.toBeInTheDocument();
  });

  describe('closing the popover before leaving the page', () => {
    it.each(['x', 'weibo'])('closes the popover before opening the %s intent', (platform) => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const onLeave = vi.fn();
      render(<SocialShare shareUrl={shareUrl} title={'My topic'} onLeave={onLeave} />);

      fireEvent.click(tile(platform));

      expect(open).toHaveBeenCalledTimes(1);
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(onLeave.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
    });

    it('calls onLeave from "Open Instagram" but not when the panel opens', async () => {
      const onLeave = vi.fn();
      render(<SocialShare shareUrl={shareUrl} title={'My topic'} onLeave={onLeave} />);

      fireEvent.click(tile('instagram'));
      await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1));
      // The caption panel has to stay up so the user can read and copy it.
      expect(onLeave).not.toHaveBeenCalled();

      const openLink = screen.getByText('shareModal.social.instagram.open').closest('a')!;
      fireEvent.click(openLink);
      expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('does not call onLeave for WeChat, which stays inside the popover', () => {
      const onLeave = vi.fn();
      render(<SocialShare shareUrl={shareUrl} title={'My topic'} onLeave={onLeave} />);

      fireEvent.click(tile('wechat'));
      expect(onLeave).not.toHaveBeenCalled();
    });
  });

  describe('resetting the open panel when the link changes', () => {
    it.each([
      ['wechat', 'social-wechat-panel'],
      ['instagram', 'social-instagram-panel'],
    ])('drops the %s panel once the link is turned off and back on', async (platform, testId) => {
      const { rerender } = render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

      fireEvent.click(tile(platform));
      await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());

      rerender(<SocialShare shareUrl={undefined} title={'My topic'} />);
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();

      rerender(<SocialShare shareUrl={shareUrl} title={'My topic'} />);
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
      expect(tile(platform)).toHaveAttribute('aria-expanded', 'false');
    });

    it.each([
      ['wechat', 'social-wechat-panel'],
      ['instagram', 'social-instagram-panel'],
    ])('drops the %s panel when another topic link takes over', async (platform, testId) => {
      const { rerender } = render(<SocialShare shareUrl={shareUrl} title={'My topic'} />);

      fireEvent.click(tile(platform));
      await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());

      rerender(
        <SocialShare shareUrl={'https://app.lobehub.com/share/t/other'} title={'Other topic'} />,
      );
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
      expect(screen.queryByTestId('qrcode')).not.toBeInTheDocument();
    });
  });
});
