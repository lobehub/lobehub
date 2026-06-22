import { describe, expect, it } from 'vitest';

import { getTabWorkspaceScope, shouldOpenTabForScopeChange } from './tabScope';

describe('tab navigation scope handling', () => {
  it('resolves the workspace scope from known workspace slugs', () => {
    const workspaceSlugs = new Set(['acme']);

    expect(getTabWorkspaceScope('/agent/personal-agent', workspaceSlugs)).toBeNull();
    expect(getTabWorkspaceScope('/acme/agent/workspace-agent', workspaceSlugs)).toBe('acme');
    expect(getTabWorkspaceScope('/unknown/agent/workspace-agent', workspaceSlugs)).toBeNull();
  });

  it('opens a separate tab when navigation crosses personal and workspace scopes', () => {
    const workspaceSlugs = new Set(['acme']);

    expect(
      shouldOpenTabForScopeChange(
        '/agent/personal-agent',
        '/acme/agent/workspace-agent',
        workspaceSlugs,
      ),
    ).toBe(true);
    expect(
      shouldOpenTabForScopeChange(
        '/acme/agent/workspace-agent',
        '/agent/personal-agent',
        workspaceSlugs,
      ),
    ).toBe(true);
  });

  it('keeps same-scope navigation inside the current tab', () => {
    const workspaceSlugs = new Set(['acme']);

    expect(shouldOpenTabForScopeChange('/agent/a', '/group/g', workspaceSlugs)).toBe(false);
    expect(shouldOpenTabForScopeChange('/acme/agent/a', '/acme/group/g', workspaceSlugs)).toBe(
      false,
    );
  });
});
