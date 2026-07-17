import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSettingsContentLayout } from './Layout';

vi.mock('@/features/NavHeader', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', undefined, children),
}));

vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, children),
}));

vi.mock('./Container', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('main', undefined, children),
}));

vi.mock('./SideBar', () => ({ default: () => null }));

vi.mock('./hooks/useCategory', () => ({
  useWorkspaceSettingCategory: () => [
    {
      items: [
        { key: 'general', label: 'General' },
        { key: 'members', label: 'Members' },
        { key: 'devices', label: 'Devices' },
        { key: 'plans', label: 'Plans' },
        { key: 'billing', label: 'Billing' },
        { key: 'credits', label: 'Credits' },
        { key: 'apikey', label: 'API Keys' },
        { key: 'service-model', label: 'Default Models' },
        { key: 'credential', label: 'Credentials' },
        { key: 'stats', label: 'Stats' },
        { key: 'storage', label: 'Storage' },
        { key: 'usage', label: 'Usage' },
        { key: 'audit-log', label: 'Audit Log' },
      ],
    },
  ],
}));

const renderLayout = (tab: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/acme/settings/${tab}`]}>
      <Routes>
        <Route element={<WorkspaceSettingsContentLayout />} path="/:workspaceSlug/settings">
          <Route element={<div>Page content</div>} path=":tab" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('WorkspaceSettingsContentLayout', () => {
  it.each([
    ['general', 'General'],
    ['members', 'Members'],
    ['devices', 'Devices'],
    ['plans', 'Plans'],
    ['billing', 'Billing'],
    ['credits', 'Credits'],
    ['apikey', 'API Keys'],
    ['service-model', 'Default Models'],
    ['credential', 'Credentials'],
    ['stats', 'Stats'],
    ['storage', 'Storage'],
    ['usage', 'Usage'],
  ])('renders the compact header for the %s tab', (tab, title) => {
    const html = renderLayout(tab);

    expect(html).toContain(`<header>${title}</header>`);
    expect(html).toContain('<main><div>Page content</div></main>');
  });

  it('keeps non-compact tabs on the existing content-only layout', () => {
    const html = renderLayout('audit-log');

    expect(html).not.toContain('<header>');
    expect(html).toContain('<main><div>Page content</div></main>');
  });
});
