import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCacheScope,
  clearActiveScopeKey,
  getCacheScope,
  isAnonymousScope,
  isScopeTrusted,
} from './useCacheScope';

let mockUserId: string | null | undefined = undefined;
let mockIsAuthLoaded = false;
let mockWorkspaceId: string | null = null;

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({ user: { id: mockUserId }, isLoaded: mockIsAuthLoaded }),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLoaded: (s: any) => s.isLoaded },
  userProfileSelectors: { userId: (s: any) => s.user?.id },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mockWorkspaceId,
  useActiveWorkspaceId: () => mockWorkspaceId,
}));

describe('buildCacheScope', () => {
  it('falls back to anon/personal', () => {
    expect(buildCacheScope(undefined, undefined)).toBe('anon:personal');
    expect(buildCacheScope(null, null)).toBe('anon:personal');
  });

  it('combines user and workspace', () => {
    expect(buildCacheScope('u1', 'w1')).toBe('u1:w1');
    expect(buildCacheScope('u1', null)).toBe('u1:personal');
  });

  it('isolates different users and workspaces', () => {
    expect(buildCacheScope('u1', 'w1')).not.toBe(buildCacheScope('u2', 'w1'));
    expect(buildCacheScope('u1', 'w1')).not.toBe(buildCacheScope('u1', 'w2'));
  });
});

describe('isAnonymousScope', () => {
  it('matches the anon partition only', () => {
    expect(isAnonymousScope('anon:personal')).toBe(true);
    expect(isAnonymousScope('u1:personal')).toBe(false);
  });
});

describe('activeScopeKey + optimistic scope', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUserId = undefined;
    mockIsAuthLoaded = false;
    mockWorkspaceId = null;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('getCacheScope falls back to anon when no userId and no persisted scope (first-ever boot)', () => {
    expect(getCacheScope()).toBe('anon:personal');
  });

  it('getCacheScope returns the persisted activeScopeKey optimistically when userId is unresolved', () => {
    localStorage.setItem('lobehub:active-scope', 'user_abc:w1');
    // userId still unresolved — but we hydrate the last-known user partition
    expect(getCacheScope()).toBe('user_abc:w1');
  });

  it('getCacheScope prefers the real resolved scope over the persisted one', () => {
    localStorage.setItem('lobehub:active-scope', 'user_abc:w1');
    mockUserId = 'user_real';
    mockWorkspaceId = 'w2';
    expect(getCacheScope()).toBe('user_real:w2');
  });

  it('clearActiveScopeKey removes the persisted scope (logout)', () => {
    localStorage.setItem('lobehub:active-scope', 'user_abc:personal');
    clearActiveScopeKey();
    expect(localStorage.getItem('lobehub:active-scope')).toBeNull();
    // → next getCacheScope (userId unresolved) falls back to anon
    expect(getCacheScope()).toBe('anon:personal');
  });
});

describe('isScopeTrusted', () => {
  beforeEach(() => {
    mockIsAuthLoaded = false;
  });

  it('is untrusted while the session check is in flight', () => {
    mockIsAuthLoaded = false;
    expect(isScopeTrusted()).toBe(false);
  });

  it('is trusted once the session check resolves (covers both signed-in and no-auth)', () => {
    mockIsAuthLoaded = true;
    expect(isScopeTrusted()).toBe(true);
  });
});
