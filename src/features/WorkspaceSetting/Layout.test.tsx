import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSettingsContentLayout } from './Layout';

vi.mock('@/features/NavHeader', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', undefined, children),
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
        { key: 'statistics', label: 'Statistics' },
        { key: 'storage', label: 'Storage' },
        { key: 'usage', label: 'Usage' },
        { key: 'audit-log', label: 'Audit Log' },
        { key: 'profile', label: 'Jane Doe' },
        { key: 'appearance', label: 'Appearance' },
        { key: 'hotkey', label: 'Hotkeys' },
        { key: 'messenger', label: 'Messenger' },
        { key: 'labs', label: 'Labs' },
        { key: 'advanced', label: 'Advanced' },
        { key: 'about', label: 'About' },
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
    ['statistics', 'Statistics'],
    ['storage', 'Storage'],
    ['usage', 'Usage'],
    ['appearance', 'Appearance'],
    ['hotkey', 'Hotkeys'],
    ['messenger', 'Messenger'],
    ['labs', 'Labs'],
    ['about', 'About'],
    // The Profile nav item is labelled with the user's name; the header keeps
    // the generic page title.
    ['profile', 'profile.title'],
  ])('renders the compact header for the %s tab', (tab, title) => {
    const html = renderLayout(tab);

    expect(html).toMatch(
      new RegExp(`<header>(?:(?!</header>).)*>${title}<(?:(?!<header>).)*</header>`),
    );
    expect(html).toContain('<main><div>Page content</div></main>');
  });

  it.each(['audit-log', 'advanced'])('keeps the %s tab on the content-only layout', (tab) => {
    const html = renderLayout(tab);

    expect(html).not.toContain('<header>');
    expect(html).toContain('<main><div>Page content</div></main>');
  });
});
