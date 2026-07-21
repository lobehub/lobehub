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
  Avatar: ({ avatar, title }: { avatar?: string; title?: string }) => (
    <span data-avatar={avatar ?? ''} data-testid="avatar" data-title={title ?? ''} />
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

describe('TopicCreatorAvatar', () => {
  it("renders a workspace member's avatar (including the current user's own topics)", () => {
    // In a workspace `useAuthorInfo` resolves the creator profile from members —
    // for every topic, not just other members'.
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId } = render(<TopicCreatorAvatar userId="any-member" />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith('any-member');
    const avatar = getByTestId('avatar');
    expect(avatar.getAttribute('data-avatar')).toBe('https://x/y.png');
    expect(avatar.getAttribute('data-title')).toBe('Alice');
  });

  it('renders nothing in personal mode / when the creator is not a resolvable member', () => {
    // No active workspace → the slot resolves to undefined → no avatar.
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar userId="someone" />);

    expect(queryByTestId('avatar')).toBeNull();
  });

  it('renders nothing when no userId is provided (default / temp topic)', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith(undefined);
    expect(queryByTestId('avatar')).toBeNull();
  });
});
