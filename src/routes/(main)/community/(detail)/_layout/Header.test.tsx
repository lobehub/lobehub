// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MarkdownRender from '../features/MakedownRender';
import Header from './Header';

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

describe('Community detail Header', () => {
  it('only offers the way back: no store search or account avatar', () => {
    render(
      <MemoryRouter initialEntries={['/011/marketplace/org/sad']}>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByTestId('community-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('community-user-avatar')).not.toBeInTheDocument();
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
