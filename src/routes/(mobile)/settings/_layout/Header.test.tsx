import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, children),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({ center }: { center?: React.ReactNode }) =>
    React.createElement('header', undefined, center);

  ChatHeader.Title = ({ title }: { title?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, title);

  return { ChatHeader };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({ useShowMobileWorkspace: () => false }));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { activeId?: string }) => unknown) => selector({}),
}));

const renderHeader = (tab: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/acme/settings/${tab}`]}>
      <Header />
    </MemoryRouter>,
  );

describe('mobile settings Header', () => {
  it.each([
    ['general', 'setting:workspaceSetting.tab.general'],
    ['members', 'setting:workspaceSetting.tab.members'],
    ['plans', 'subscription:tab.plans'],
    ['billing', 'subscription:tab.billing'],
    ['credits', 'subscription:tab.credits'],
    ['devices', 'setting:tab.devices'],
    ['service-model', 'setting:tab.serviceModel'],
  ])('resolves the workspace %s title', (tab, title) => {
    const html = renderHeader(tab);

    expect(html).toContain('<header>');
    expect(html).toContain(`>${title}</span></header>`);
  });
});
