import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentSidebarContent from './Content';

const mocks = vi.hoisted(() => ({ pathname: '/agent/agt_1' }));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock('@/features/NavPanel/SideBarLayout', () => ({
  default: ({ body }: { body: React.ReactNode }) => <div>{body}</div>,
}));
vi.mock('./Body', () => ({ default: () => <div>topics</div> }));
vi.mock('./Header', () => ({ default: () => null }));
vi.mock('./ProfileNav', () => ({
  default: ({ active }: { active: string }) => <div>profile-nav:{active}</div>,
}));

describe('AgentSidebarContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['/agent/agt_1/profile', 'profile'],
    ['/agent/agt_1/channel/slack', 'channel'],
    ['/agent/agt_1/statistics', 'statistics'],
    ['/agent/agt_1/share', 'share'],
    ['/agent/agt_1/self-evolving', 'self-evolving'],
    ['/agent/agt_1/self-evolving/dom_1/experience', 'self-evolving'],
  ])('replaces the topic sidebar on %s', (pathname, tab) => {
    mocks.pathname = pathname;
    render(<AgentSidebarContent />);

    expect(screen.getByText(`profile-nav:${tab}`)).toBeInTheDocument();
    expect(screen.queryByText('topics')).not.toBeInTheDocument();
  });

  it('keeps the topic sidebar in the chat', () => {
    mocks.pathname = '/agent/agt_1';
    render(<AgentSidebarContent />);

    expect(screen.getByText('topics')).toBeInTheDocument();
  });

  it('keeps the topic sidebar on mobile, which still uses the header switcher', () => {
    vi.stubGlobal('__MOBILE__', true);
    mocks.pathname = '/agent/agt_1/profile';
    render(<AgentSidebarContent />);

    expect(screen.getByText('topics')).toBeInTheDocument();
  });
});
