import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceGeneralAccess } from '@/services/resourcePermission';

import {
  AccessScopeChangedError,
  fetchGeneralAccess,
  getAccessRequestGeneration,
  resetConfirmedAccessForTest,
  useResourceAccess,
} from './useResourceAccess';

const testState = vi.hoisted(() => ({
  data: undefined as ResourceGeneralAccess | undefined,
  error: undefined as Error | undefined,
  fetcher: undefined as (() => Promise<ResourceGeneralAccess>) | undefined,
  getGeneralAccess: vi.fn(),
  hasActiveWorkspace: true,
  isValidating: false,
  scope: 'user-1:ws-a',
  scopeTrusted: true,
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => testState.hasActiveWorkspace,
}));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => testState.scope,
  useIsScopeTrusted: () => testState.scopeTrusted,
}));

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: { getGeneralAccess: testState.getGeneralAccess },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (_key: unknown, fetcher: () => Promise<ResourceGeneralAccess>) => {
    testState.fetcher = fetcher;
    return {
      data: testState.data,
      error: testState.error,
      isLoading: false,
      isValidating: testState.isValidating,
      mutate: vi.fn(),
    };
  },
}));

const record = (overrides: Partial<ResourceGeneralAccess>): ResourceGeneralAccess => ({
  accessLevel: 'edit',
  canManage: false,
  creatorId: 'creator',
  generalAccess: 'editor',
  visibility: 'public',
  ...overrides,
});

/** Simulate SWR settling a revalidation: the fetcher resolves into `data`. */
const revalidate = async (fresh: ResourceGeneralAccess) => {
  testState.getGeneralAccess.mockResolvedValueOnce(fresh);
  testState.data = await testState.fetcher!();
  testState.isValidating = false;
};

describe('useResourceAccess', () => {
  beforeEach(() => {
    resetConfirmedAccessForTest();
    testState.data = undefined;
    testState.error = undefined;
    testState.fetcher = undefined;
    testState.getGeneralAccess.mockReset();
    testState.hasActiveWorkspace = true;
    testState.isValidating = false;
    testState.scope = 'user-1:ws-a';
    testState.scopeTrusted = true;
  });

  it('resolves from cached access while it revalidates, but does not confirm it yet', async () => {
    testState.data = record({});
    testState.isValidating = true;

    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      isAccessConfirmed: false,
      isAccessResolved: true,
    });

    await revalidate(record({}));
    rerender();

    expect(result.current.isAccessConfirmed).toBe(true);
  });

  // Regression: a persisted `canManage: true` from an earlier session rendered
  // management controls before the re-check, even if the user had since been
  // demoted. Management must stay fail-closed until this session confirms it.
  it('keeps management hidden for a cached manager grant until this session re-confirms it', async () => {
    testState.data = record({ canManage: true });
    testState.isValidating = true;

    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canManageResource: false,
      isAccessConfirmed: false,
    });

    await revalidate(record({ canManage: false }));
    rerender();

    expect(result.current).toMatchObject({ canManageResource: false, isAccessConfirmed: true });
  });

  it('grants management once this session has re-confirmed the manager grant', async () => {
    testState.data = record({ canManage: true });
    testState.isValidating = true;

    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));
    expect(result.current.canManageResource).toBe(false);

    await revalidate(record({ canManage: true }));
    rerender();

    expect(result.current.canManageResource).toBe(true);
  });

  it('does not apply view-only Member Permissions to an Agent author or admin', async () => {
    renderHook(() => useResourceAccess('agent', 'agent-1'));
    await revalidate(record({ accessLevel: 'view', canManage: true, generalAccess: 'viewer' }));

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canManageResource: true,
      canUseResource: true,
    });
  });

  it('still applies view-only Member Permissions to an ordinary member', async () => {
    renderHook(() => useResourceAccess('agent', 'agent-1'));
    await revalidate(record({ accessLevel: 'view', canManage: false, generalAccess: 'viewer' }));

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: false,
      canManageResource: false,
      canUseResource: false,
    });
  });

  // Regression: confirmations were keyed by resource id only, so after an
  // in-place user/workspace switch another scope's stale cached manager grant
  // for the same id counted as confirmed and showed management controls.
  it('does not carry a confirmation across a cache-scope switch', async () => {
    testState.data = record({ canManage: true });
    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    await revalidate(record({ canManage: true }));
    rerender();
    expect(result.current.canManageResource).toBe(true);

    testState.scope = 'user-2:ws-b';
    testState.isValidating = true;
    rerender();

    expect(result.current).toMatchObject({ canManageResource: false, isAccessConfirmed: false });

    await revalidate(record({ canManage: true }));
    rerender();
    expect(result.current.canManageResource).toBe(true);
  });

  // Regression: the SWR key has no user id, so a request issued before an
  // in-place account switch that settled after it returned the previous
  // user's record into the new user's partition, where it was persisted.
  it('rejects an access record that settles after the cache scope changed', async () => {
    let settle!: (value: ResourceGeneralAccess) => void;
    testState.getGeneralAccess.mockReturnValueOnce(
      new Promise<ResourceGeneralAccess>((resolve) => {
        settle = resolve;
      }),
    );

    const pending = fetchGeneralAccess('agent', 'agent-1');
    testState.scope = 'user-2:ws-a';
    settle(record({ canManage: true }));

    await expect(pending).rejects.toBeInstanceOf(AccessScopeChangedError);

    testState.data = record({ canManage: true });
    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));
    expect(result.current).toMatchObject({ canManageResource: false, isAccessConfirmed: false });
  });

  // Regression: a failed focus/reconnect refresh set `error` on a record this
  // session had already confirmed, which revoked management and replaced a
  // live manage-only page with a full-page error.
  it('keeps a session-confirmed manager grant through a later refresh error', async () => {
    testState.data = record({ canManage: true });
    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    await revalidate(record({ canManage: true }));
    testState.error = new Error('network');
    rerender();

    expect(result.current).toMatchObject({ canManageResource: true, isAccessConfirmed: true });
  });

  it('still blocks an unconfirmed cached manager grant when its refresh fails', () => {
    testState.data = record({ canManage: true });
    testState.error = new Error('network');

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({ canManageResource: false, isAccessConfirmed: false });
  });

  // Security: the refresh that follows a revocation can fail with a denial
  // (resource made private, moved out of the workspace, member removed). The
  // stale manager record SWR keeps must not stay confirmed through it.
  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'])(
    'revokes a session-confirmed manager grant when a refresh is denied with %s',
    async (code) => {
      testState.data = record({ canManage: true });
      const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));
      await revalidate(record({ canManage: true }));
      rerender();
      expect(result.current.canManageResource).toBe(true);

      const denial = Object.assign(new Error('denied'), { data: { code } });
      testState.getGeneralAccess.mockRejectedValueOnce(denial);
      await expect(testState.fetcher!()).rejects.toBe(denial);
      testState.error = denial;
      rerender();

      expect(result.current).toMatchObject({ canManageResource: false, isAccessConfirmed: false });
    },
  );

  it('keeps a session-confirmed manager grant when the refresh fails transiently', async () => {
    testState.data = record({ canManage: true });
    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));
    await revalidate(record({ canManage: true }));

    const outage = Object.assign(new Error('bad gateway'), {
      data: { code: 'INTERNAL_SERVER_ERROR' },
    });
    testState.getGeneralAccess.mockRejectedValueOnce(outage);
    await expect(testState.fetcher!()).rejects.toBe(outage);
    testState.error = outage;
    rerender();

    expect(result.current).toMatchObject({ canManageResource: true, isAccessConfirmed: true });
  });

  // Security: a denied refresh (resource made private, deleted, moved out of
  // the workspace, member removed) must fail edit/use closed too, not just
  // management, even though SWR keeps the previous editable record.
  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'])(
    'fails edit/use closed for a retained record once a refresh is denied with %s',
    async (code) => {
      testState.data = record({ accessLevel: 'edit', canManage: true });
      const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));
      expect(result.current).toMatchObject({ canEditResource: true, canUseResource: true });

      const denial = Object.assign(new Error('denied'), { data: { code } });
      testState.getGeneralAccess.mockRejectedValueOnce(denial);
      await expect(testState.fetcher!()).rejects.toBe(denial);
      testState.error = denial;
      rerender();

      expect(result.current).toMatchObject({
        canEditResource: false,
        canManageResource: false,
        canUseResource: false,
        isAccessResolved: true,
      });
    },
  );

  it('restores access once a refresh after a denial succeeds', async () => {
    testState.data = record({ accessLevel: 'edit' });
    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    const denial = Object.assign(new Error('denied'), { data: { code: 'NOT_FOUND' } });
    testState.getGeneralAccess.mockRejectedValueOnce(denial);
    await expect(testState.fetcher!()).rejects.toBe(denial);
    testState.error = denial;
    rerender();
    expect(result.current.canEditResource).toBe(false);

    await revalidate(record({ accessLevel: 'edit' }));
    testState.error = undefined;
    rerender();
    expect(result.current).toMatchObject({ canEditResource: true, canUseResource: true });
  });

  it('keeps edit/use from the retained record through a transient refresh failure', async () => {
    testState.data = record({ accessLevel: 'edit' });
    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    const outage = Object.assign(new Error('timeout'), { data: { code: 'TIMEOUT' } });
    testState.getGeneralAccess.mockRejectedValueOnce(outage);
    await expect(testState.fetcher!()).rejects.toBe(outage);
    testState.error = outage;
    rerender();

    expect(result.current).toMatchObject({ canEditResource: true, canUseResource: true });
  });

  it('reports the generation of the confirming request, ordered by issue', async () => {
    testState.data = record({});
    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));
    expect(result.current.confirmedGeneration).toBeUndefined();

    const before = getAccessRequestGeneration();
    await revalidate(record({}));
    rerender();
    expect(result.current.confirmedGeneration).toBe(before + 1);
    expect(getAccessRequestGeneration()).toBe(before + 1);
  });

  // The persisted row ages from this stamp (see LOCAL_SNAPSHOT_PATTERNS).
  it('stamps each fetched record with its fetch time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(4242);
    testState.getGeneralAccess.mockResolvedValueOnce(record({}));
    renderHook(() => useResourceAccess('agent', 'agent-1'));

    await expect(testState.fetcher!()).resolves.toMatchObject({ fetchedAt: 4242 });
    vi.restoreAllMocks();
  });

  // Security: before the identity resolves, the cache partition is the
  // last-known user's, so a cold boot with an expired session or an
  // out-of-band account switch must not act on that account's cached record.
  it('does not resolve a cached record until the cache scope is trusted', () => {
    testState.scopeTrusted = false;
    testState.data = record({ accessLevel: 'edit' });

    const { result, rerender } = renderHook(() => useResourceAccess('agent', 'agent-1'));
    expect(result.current.isAccessResolved).toBe(false);

    testState.scopeTrusted = true;
    rerender();
    expect(result.current.isAccessResolved).toBe(true);
  });
});
