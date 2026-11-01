import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import type { ResourceGeneralAccess } from '@/services/resourcePermission';
import { resourcePermissionActions, useResourcePermissionStore } from '@/store/resourcePermission';

import { useResourceAccess } from './useResourceAccess';

const testState = vi.hoisted(() => ({
  hasActiveWorkspace: true,
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => testState.hasActiveWorkspace,
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(async () => undefined),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const KEY = 'agent:agent-1';

const record = (overrides: Partial<ResourceGeneralAccess>): ResourceGeneralAccess => ({
  accessLevel: 'view',
  canManage: false,
  creatorId: 'creator',
  generalAccess: 'viewer',
  visibility: 'public',
  ...overrides,
});

/** Seed the record on screen; `check` is what the server answered this session. */
const seed = (data: ResourceGeneralAccess | undefined, check?: 'confirmed' | 'denied') =>
  useResourcePermissionStore.setState({
    accessMap: data ? { [KEY]: data } : {},
    accessSessionMap: check ? { [`${cacheScope.get()}|${KEY}`]: check } : {},
  });

describe('useResourceAccess', () => {
  beforeEach(() => {
    resourcePermissionActions.reset();
    testState.hasActiveWorkspace = true;
  });

  it('does not apply view-only Member Permissions to an Agent author or admin', () => {
    seed(record({ canManage: true }), 'confirmed');

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canManageResource: true,
      canUseResource: true,
    });
  });

  it('still applies view-only Member Permissions to an ordinary member', () => {
    seed(record({ canManage: false }), 'confirmed');

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: false,
      canManageResource: false,
      canUseResource: false,
    });
  });

  it('resolves edit/use from a persisted record before the server answers', () => {
    seed(record({ accessLevel: 'edit', canManage: true, generalAccess: 'editor' }));

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canUseResource: true,
      isAccessResolved: true,
      isLoading: false,
    });
    // Management stays fail-closed until this session re-fetches the record.
    expect(result.current.canManageResource).toBe(false);
    expect(result.current.isAccessConfirmed).toBe(false);
  });

  it('fails every check closed once the server denies access this session', () => {
    seed(undefined, 'denied');

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      access: undefined,
      canEditResource: false,
      canManageResource: false,
      canUseResource: false,
      isAccessConfirmed: true,
      isAccessResolved: true,
      isLoading: false,
    });
  });

  it('stays permissive and loading while there is no record yet', () => {
    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canManageResource: false,
      canUseResource: true,
      isAccessResolved: false,
      isLoading: true,
    });
  });

  it('keeps full access in personal mode', () => {
    testState.hasActiveWorkspace = false;

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canManageResource: true,
      canUseResource: true,
      isAccessResolved: true,
      isLoading: false,
    });
  });
});
