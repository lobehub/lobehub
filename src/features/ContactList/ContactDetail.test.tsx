/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactDetail } from './ContactDetail';

const navigate = vi.hoisted(() => vi.fn());
const agentList = vi.hoisted(() => ({ init: true, items: [] as { id: string }[] }));
const access = vi.hoisted(() => ({ canEdit: true }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => ({}) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: access.canEdit }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    getAgentById: (id: string) => () => agentList.items.find((item) => item.id === id),
    isAgentListInit: () => agentList.init,
  },
}));
vi.mock('./ContactAvatar', () => ({ default: () => null }));

beforeEach(() => {
  navigate.mockReset();
  access.canEdit = true;
  agentList.init = true;
  agentList.items = [
    {
      description: 'Turns ideas into product specs',
      id: 'agt_1',
      name: 'Ada',
      slug: 'ada',
      title: 'Product Helper',
    },
    { id: 'grp_1', title: 'Launch Crew', type: 'group' },
  ] as { id: string }[];
});

describe('ContactDetail', () => {
  it('shows the agent card and opens its chat on Send message', () => {
    render(createElement(ContactDetail, { id: 'agt_1' }));

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Product Helper · @ada')).toBeInTheDocument();
    expect(screen.getByText('Turns ideas into product specs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /contacts.sendMessage/ }));
    expect(navigate).toHaveBeenCalledWith('/agent/agt_1');
  });

  it('opens the profile editor from Edit profile', () => {
    render(createElement(ContactDetail, { id: 'agt_1' }));

    fireEvent.click(screen.getByRole('button', { name: /contacts.editProfile/ }));
    expect(navigate).toHaveBeenCalledWith('/agent/agt_1/profile');
  });

  it('opens a group chat for a group contact', () => {
    render(createElement(ContactDetail, { id: 'grp_1' }));

    fireEvent.click(screen.getByRole('button', { name: /contacts.sendMessage/ }));
    expect(navigate).toHaveBeenCalledWith('/group/grp_1');
  });

  it('hides Edit profile from viewers who cannot edit the agent', () => {
    access.canEdit = false;

    render(createElement(ContactDetail, { id: 'agt_1' }));

    expect(screen.queryByRole('button', { name: /contacts.editProfile/ })).not.toBeInTheDocument();
  });

  it('says the contact is gone once the list has loaded without it', () => {
    render(createElement(ContactDetail, { id: 'agt_missing' }));

    expect(screen.getByText('contacts.notFound')).toBeInTheDocument();
  });
});
