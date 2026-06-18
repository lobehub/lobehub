// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

const mocks = vi.hoisted(() => ({
  useUserProfile: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: () => void }) => (
    <button data-testid="back-button" onClick={onClick} />
  ),
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) => (
    <header>
      <div>{left}</div>
      <div>{right}</div>
    </header>
  ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/routes/(main)/community/features/Search', () => ({
  default: () => <div data-testid="community-search" />,
}));

vi.mock('@/routes/(main)/community/features/UserAvatar', () => ({
  default: ({ avatarOverride }: { avatarOverride?: string | null }) => (
    <div data-avatar={avatarOverride ?? ''} data-testid="community-user-avatar" />
  ),
}));

vi.mock('@/store/discover', () => ({
  useDiscoverStore: (
    selector: (state: { useUserProfile: typeof mocks.useUserProfile }) => unknown,
  ) => selector({ useUserProfile: mocks.useUserProfile }),
}));

describe('Community detail Header', () => {
  it('shows the viewed organization avatar in the right corner', () => {
    mocks.useUserProfile.mockReturnValue({
      data: {
        user: {
          avatarUrl: 'sad-avatar',
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/011/community/org/sad']}>
        <Header />
      </MemoryRouter>,
    );

    expect(mocks.useUserProfile).toHaveBeenCalledWith({ username: 'sad' });
    expect(screen.getByTestId('community-user-avatar')).toHaveAttribute(
      'data-avatar',
      'sad-avatar',
    );
  });
});
