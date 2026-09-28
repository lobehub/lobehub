// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MarkdownRender from '../features/MakedownRender';
import Header from './Header';

const mocks = vi.hoisted(() => ({
  useUserProfile: vi.fn(),
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

describe('Community detail Markdown', () => {
  it('renders standard Markdown without creating raw HTML elements', () => {
    const { container } = render(
      <MarkdownRender>
        {'**community-safe**\n\n<aside data-raw-html="true">raw HTML</aside>'}
      </MarkdownRender>,
    );

    expect(screen.getByText('community-safe', { selector: 'strong' })).toBeInTheDocument();
    expect(container.querySelector('[data-raw-html]')).not.toBeInTheDocument();
  });
});
