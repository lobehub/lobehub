/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicCreatorAvatar from './index';

const useAuthorInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: useAuthorInfoMock,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar, shape, title }: { avatar?: string; shape?: string; title?: string }) => (
    <span
      data-avatar={avatar ?? ''}
      data-shape={shape ?? ''}
      data-testid="avatar"
      data-title={title ?? ''}
    />
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

describe('TopicCreatorAvatar', () => {
  it("renders a workspace member's round avatar (any member, including self)", () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId } = render(<TopicCreatorAvatar userId="any-member" />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith('any-member');
    const avatar = getByTestId('avatar');
    expect(avatar.getAttribute('data-avatar')).toBe('https://x/y.png');
    expect(avatar.getAttribute('data-shape')).toBe('circle');
    expect(avatar.getAttribute('data-title')).toBe('Alice');
  });

  it('keeps the avatar primary and shrinks the row icon into the corner badge', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId } = render(
      <TopicCreatorAvatar corner={<span data-testid="status-icon" />} userId="any-member" />,
    );

    // Both the full avatar and the corner-badged row icon render.
    expect(getByTestId('avatar')).toBeTruthy();
    expect(getByTestId('status-icon')).toBeTruthy();
  });

  it('renders the bare avatar when no corner node is provided', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId, queryByTestId } = render(<TopicCreatorAvatar userId="any-member" />);

    expect(getByTestId('avatar')).toBeTruthy();
    expect(queryByTestId('status-icon')).toBeNull();
  });

  it('renders nothing in personal mode / when the creator is not a resolvable member', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(
      <TopicCreatorAvatar corner={<span data-testid="status-icon" />} userId="someone" />,
    );

    // No avatar AND no corner badge — the caller falls back to its own layout.
    expect(queryByTestId('avatar')).toBeNull();
    expect(queryByTestId('status-icon')).toBeNull();
  });

  it('renders nothing when no userId is provided (default / temp topic)', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith(undefined);
    expect(queryByTestId('avatar')).toBeNull();
  });
});
