import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getTabPages,
  saveTabPages,
  TAB_PAGES_STORAGE_KEY_V1,
  TAB_PAGES_STORAGE_KEY_V2,
  tabPagesStorageKey,
} from './storage';

const personalScope = { type: 'personal' } as const;
const acmeScope = { slug: 'acme', type: 'workspace' } as const;

describe('TabBar storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns empty scoped data when nothing is stored', () => {
    expect(getTabPages(personalScope)).toEqual({ activeTabId: null, tabs: [] });
    expect(getTabPages(acmeScope)).toEqual({ activeTabId: null, tabs: [] });
  });

  it('round-trips personal and workspace tab buckets independently', () => {
    saveTabPages(
      personalScope,
      [{ id: 'personal-tab', lastVisited: 1, url: '/agent/abc' }],
      'personal-tab',
    );
    saveTabPages(
      acmeScope,
      [{ id: 'workspace-tab', lastVisited: 2, url: '/acme/agent/abc' }],
      'workspace-tab',
    );

    expect(getTabPages(personalScope)).toEqual({
      activeTabId: 'personal-tab',
      tabs: [{ id: 'personal-tab', lastVisited: 1, url: '/agent/abc' }],
    });
    expect(getTabPages(acmeScope)).toEqual({
      activeTabId: 'workspace-tab',
      tabs: [{ id: 'workspace-tab', lastVisited: 2, url: '/acme/agent/abc' }],
    });
  });

  it('does not read legacy global tab storage keys', () => {
    window.localStorage.setItem(
      TAB_PAGES_STORAGE_KEY_V1,
      JSON.stringify({
        activeTabId: 'agent:abc',
        tabs: [{ id: 'agent:abc', lastVisited: 1, params: { agentId: 'abc' }, type: 'agent' }],
      }),
    );
    window.localStorage.setItem(
      TAB_PAGES_STORAGE_KEY_V2,
      JSON.stringify({
        activeTabId: '/agent/abc',
        tabs: [{ id: '/agent/abc', lastVisited: 1, url: '/agent/abc' }],
      }),
    );

    expect(getTabPages(personalScope)).toEqual({ activeTabId: null, tabs: [] });
  });

  it('stores workspace buckets under their own key', () => {
    saveTabPages(
      acmeScope,
      [{ id: 'workspace-tab', lastVisited: 1, url: '/acme' }],
      'workspace-tab',
    );

    expect(window.localStorage.getItem(tabPagesStorageKey(personalScope))).toBeNull();
    expect(window.localStorage.getItem(tabPagesStorageKey(acmeScope))).toContain('workspace-tab');
  });
});
