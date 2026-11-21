import { render } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import InstalledNav from './InstalledNav';
import { buildInstalledDetailPath } from './paths';

vi.mock('./Apps/ConnectedAppNav', () => ({ default: () => null }));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/acme/marketplace/mcp', search: '' }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'acme',
}));

describe('buildInstalledDetailPath', () => {
  it('opens one installed item on its installed page', () => {
    expect(buildInstalledDetailPath('skill', 'skill_123', 'agent-skill')).toBe(
      '/marketplace/skill/installed?open=agent-skill%3Askill_123',
    );
    expect(buildInstalledDetailPath('mcp', 'acme:ci', 'mcp-connector')).toBe(
      '/marketplace/mcp/installed?open=mcp-connector%3Aacme%3Aci',
    );
  });
});

describe('buildInstalledDetailPath in a workspace', () => {
  // A private and a shared connector may share an identifier; without the tab
  // the installed page resolves the shared row.
  it('opens a private connector on the Private tab', () => {
    expect(buildInstalledDetailPath('mcp', 'acme', 'mcp-connector', 'private')).toBe(
      '/marketplace/mcp/installed?open=mcp-connector%3Aacme&visibility=private',
    );
  });

  it('opens a shared connector on the default (shared) tab', () => {
    expect(buildInstalledDetailPath('mcp', 'acme', 'mcp-connector', 'public')).toBe(
      '/marketplace/mcp/installed?open=mcp-connector%3Aacme',
    );
  });
});

it('keeps the connected apps collection in the sidebar and the installed MCP collection in its catalog', () => {
  const view = render(createElement(MemoryRouter, null, createElement(InstalledNav)));
  expect(view.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '/acme/marketplace/app?view=connected',
  ]);
});
