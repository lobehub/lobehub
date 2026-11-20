import { describe, expect, it } from 'vitest';

import { getManageLibraryPath, getMarketplaceSubPath, hasCatalogPageHeader } from './paths';

describe('getMarketplaceSubPath', () => {
  it.each([
    ['/marketplace', ''],
    ['/marketplace/skill', 'skill'],
    ['/marketplace/skill/installed', 'skill/installed'],
    ['/acme/marketplace/connector', 'connector'],
    // Legacy URLs resolve the same way until their redirect runs.
    ['/community/mcp', 'mcp'],
    ['/acme/community/agent/x', 'agent/x'],
  ])('%s → %s', (pathname, sub) => {
    expect(getMarketplaceSubPath(pathname)).toBe(sub);
  });

  it('ignores a marketplace segment deeper than the workspace slug', () => {
    expect(getMarketplaceSubPath('/acme/agent/x/marketplace')).toBeUndefined();
    expect(getMarketplaceSubPath('/settings/profile')).toBeUndefined();
  });
});

describe('getManageLibraryPath', () => {
  it('sends the skills group to installed skills and tools to installed connectors', () => {
    expect(getManageLibraryPath('skills')).toBe('/marketplace/skill/installed');
    expect(getManageLibraryPath('tools')).toBe('/marketplace/connector/installed');
    expect(getManageLibraryPath()).toBe('/marketplace/connector/installed');
  });
});

describe('hasCatalogPageHeader', () => {
  it.each([
    ['/marketplace/skill', true],
    ['/workspace/marketplace/connector/', true],
    ['/marketplace', false],
    ['/marketplace/agent', true],
    ['/workspace/marketplace/agent/example', false],
    ['/marketplace/skill/installed', false],
    ['/marketplace/skill/example', false],
    ['/marketplace/mcp/example', false],
  ])('selects the page toolbar for %s: %s', (path, expected) => {
    expect(hasCatalogPageHeader(path)).toBe(expected);
  });
});
