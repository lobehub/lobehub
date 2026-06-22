/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicCreatorAvatar from './index';

const CURRENT_USER_ID = 'me';

const useAuthorInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: useAuthorInfoMock,
}));

// `useUserStore(selector)` → run the selector against a fixed state so the
// component sees a stable current user id.
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: { userId: string }) => unknown) =>
    selector({ userId: CURRENT_USER_ID }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (s: { userId: string }) => s.userId },
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar, title }: { avatar?: string; title?: string }) => (
    <span data-avatar={avatar ?? ''} data-testid="avatar" data-title={title ?? ''} />
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

describe('TopicCreatorAvatar', () => {
  it("renders another member's avatar for topics they created", () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId } = render(<TopicCreatorAvatar userId="someone-else" />);

    // The slot is queried with the *creator* id (not the current user).
    expect(useAuthorInfoMock).toHaveBeenCalledWith('someone-else');
    const avatar = getByTestId('avatar');
    expect(avatar.getAttribute('data-avatar')).toBe('https://x/y.png');
    expect(avatar.getAttribute('data-title')).toBe('Alice');
  });

  it("renders nothing for the current user's own topics", () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar userId={CURRENT_USER_ID} />);

    // Own topic → slot is called with undefined so it never resolves a profile.
    expect(useAuthorInfoMock).toHaveBeenCalledWith(undefined);
    expect(queryByTestId('avatar')).toBeNull();
  });

  it('renders nothing when the creator is not a resolvable workspace member', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar userId="ghost" />);

    expect(queryByTestId('avatar')).toBeNull();
  });

  it('renders nothing when no userId is provided (personal / default topic)', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith(undefined);
    expect(queryByTestId('avatar')).toBeNull();
  });
});
