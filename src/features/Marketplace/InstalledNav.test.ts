import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const { installedList, activeLocation } = vi.hoisted(() => ({
  activeLocation: { pathname: '/acme/marketplace/connector/installed', search: '' },
  installedList: vi.fn(() => null),
}));
vi.mock('@/features/Settings/skill/features/SkillList', () => ({ default: installedList }));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => activeLocation }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws_1',
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'acme',
}));

const {
  default: InstalledNav,
  buildInstalledDetailPath,
  getInstalledVisibility,
} = await import('./InstalledNav');

describe('buildInstalledDetailPath', () => {
  it('opens one installed item on its installed page', () => {
    expect(buildInstalledDetailPath('skill', 'skill_123', 'agent-skill')).toBe(
      '/marketplace/skill/installed?open=agent-skill%3Askill_123',
    );
    expect(buildInstalledDetailPath('connector', 'acme:ci', 'mcp-connector')).toBe(
      '/marketplace/connector/installed?open=mcp-connector%3Aacme%3Aci',
    );
  });
});

describe('getInstalledVisibility', () => {
  it('has no tab outside a workspace or for skills', () => {
    expect(getInstalledVisibility('connector', null, 'private')).toBeUndefined();
    expect(getInstalledVisibility('skill', 'ws_1', 'private')).toBeUndefined();
  });

  it('lists the tab the installed page is on, the shared pool by default', () => {
    expect(getInstalledVisibility('connector', 'ws_1', null)).toBe('public');
    expect(getInstalledVisibility('connector', 'ws_1', 'private')).toBe('private');
  });
});

describe('buildInstalledDetailPath in a workspace', () => {
  // A private and a shared connector may share an identifier; without the tab
  // the installed page resolves the shared row.
  it('opens a private connector on the Private tab', () => {
    expect(buildInstalledDetailPath('connector', 'acme', 'mcp-connector', 'private')).toBe(
      '/marketplace/connector/installed?open=mcp-connector%3Aacme&visibility=private',
    );
  });

  it('opens a shared connector on the default (shared) tab', () => {
    expect(buildInstalledDetailPath('connector', 'acme', 'mcp-connector', 'public')).toBe(
      '/marketplace/connector/installed?open=mcp-connector%3Aacme',
    );
  });
});

describe('installed connector sidebar selection', () => {
  it('highlights the connector from the active desktop tab even when the shell router is on another URL', () => {
    activeLocation.search = '?open=mcp-connector%3Aacme%3Aci&visibility=private';
    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(InstalledNav)));
    expect(installedList).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIdentifier: 'acme:ci', visibility: 'private' }),
      undefined,
    );
  });
});

describe('installed connector collection link', () => {
  it.each([
    ['/acme/marketplace/connector', '', ''],
    [
      '/acme/marketplace/connector/installed',
      '?open=mcp-connector%3Aexample&visibility=private',
      '?visibility=private',
    ],
  ])(
    'opens the collection from %s%s even without visible rows',
    (pathname, search, expectedSearch) => {
      Object.assign(activeLocation, { pathname, search });
      const router = createMemoryRouter([{ path: '*', element: createElement(InstalledNav) }], {
        initialEntries: [pathname + search],
      });
      const view = render(createElement(RouterProvider, { router }));
      const link = view.getByRole('link', { name: /installed/i });
      const expectedPath = '/acme/marketplace/connector/installed';
      expect(link.getAttribute('href')).toBe(expectedPath + expectedSearch);
      fireEvent.click(link);
      expect(router.state.location.pathname + router.state.location.search).toBe(
        expectedPath + expectedSearch,
      );
    },
  );
});
