/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactListBody } from './index';

const fetch = vi.hoisted(() => ({ error: undefined as unknown, mutate: vi.fn() }));
const agentList = vi.hoisted(() => ({ init: false, items: [] as object[] }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => ({ pathname: '/' }) }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => fetch }));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    allAgents: () => agentList.items,
    isAgentListInit: () => agentList.init,
  },
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to, ...rest }: { children: ReactNode; to: string }) =>
    createElement('a', { href: to, ...rest }, children),
}));
vi.mock('@/components/Avatar', () => ({ default: () => createElement('span') }));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => createElement('div', {}, 'Loading contacts'),
}));
vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: { onRetry?: () => void }) =>
    createElement('button', { onClick: onRetry, type: 'button' }, 'Retry contacts'),
}));

beforeEach(() => {
  agentList.init = false;
  agentList.items = [];
  fetch.error = undefined;
  fetch.mutate.mockReset();
});

describe('ContactListBody', () => {
  it('shows the skeleton while the first load is in flight', () => {
    render(createElement(ContactListBody));

    expect(screen.getByText('Loading contacts')).toBeInTheDocument();
  });

  it('shows a retryable error when the first load fails', () => {
    fetch.error = new Error('network');

    render(createElement(ContactListBody));

    expect(screen.queryByText('Loading contacts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry contacts'));
    expect(fetch.mutate).toHaveBeenCalled();
  });

  it('shows each contact as avatar and name only, without the description', () => {
    agentList.init = true;
    agentList.items = [
      { description: 'Turns ideas into product specs', id: 'agt_1', title: 'Product Helper' },
    ];

    render(createElement(ContactListBody));

    expect(screen.getByRole('link', { name: 'Product Helper' })).toHaveTextContent(
      /^Product Helper$/,
    );
    expect(screen.queryByText('Turns ideas into product specs')).not.toBeInTheDocument();
  });

  it('opens the contact card instead of the profile editor', () => {
    agentList.init = true;
    agentList.items = [
      { id: 'agt_1', title: 'Product Helper' },
      { id: 'grp_1', title: 'Launch Crew', type: 'group' },
    ];

    render(createElement(ContactListBody));

    expect(screen.getByRole('link', { name: 'Product Helper' })).toHaveAttribute(
      'href',
      '/agents/agt_1',
    );
    expect(screen.getByRole('link', { name: 'Launch Crew' })).toHaveAttribute(
      'href',
      '/agents/grp_1',
    );
  });
});
