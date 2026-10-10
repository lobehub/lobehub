/**
 * @vitest-environment happy-dom
 *
 * The user bootstrap is a `@lobechat/replica` resource whose view is the user
 * store's flat flags (`isUserStateInit`, `user`, `settings` …). It stays
 * memory-only on purpose: `@/store/user/displaySnapshot` — not a persisted
 * payload — bridges a cold boot, so entitlement (`isFreePlan`) and onboarding
 * can never be restored stale. Scope isolation is the other guarantee: a switch
 * drops the previous identity's bootstrap before the new response lands.
 */
import type { UserInitializationState } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { type GlobalServerConfig } from '@/types/serverConfig';

import { initialCommonState } from './initialState';
import { createUserStateResource } from './projection';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    {
      value: { dedupingInterval: 0, provider: () => new Map(), shouldRetryOnError: false },
    },
    createElement(MutateBridge),
    children,
  );

const SERVER_CONFIG = {} as GlobalServerConfig;

const payload = (overrides: Partial<UserInitializationState> = {}): UserInitializationState =>
  ({ preference: {}, settings: {}, userId: 'user-1', ...overrides }) as UserInitializationState;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

describe('user bootstrap replica', () => {
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope('user-a:personal');
    useUserStore.setState({ ...initialCommonState });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const renderSync = () =>
    renderHook(() => useUserStore((s) => s.useInitUserState)(true, SERVER_CONFIG), { wrapper });

  it('is memory-only — it never writes to, or hydrates from, storage', () => {
    const resource = createUserStateResource();
    expect(resource.persisted).toBe(false);
    expect(resource.storage).toBeUndefined();
  });

  it('projects the confirmed payload onto the flat flags', async () => {
    vi.spyOn(userService, 'getUserState').mockResolvedValue(
      payload({ avatar: 'a1', canEnableTrace: false, isFreePlan: false }),
    );

    renderSync();

    await waitFor(() => expect(useUserStore.getState().isUserStateInit).toBe(true));
    expect(useUserStore.getState().isFreePlan).toBe(false);
    expect(useUserStore.getState().user?.avatar).toBe('a1');
    expect(useUserStore.getState().user?.id).toBe('user-1');
  });

  it('keeps the confirmed payload reference when a refresh returns an unchanged value', async () => {
    const getUserState = vi.spyOn(userService, 'getUserState').mockResolvedValue(payload());
    renderSync();
    await waitFor(() => expect(useUserStore.getState().isUserStateInit).toBe(true));
    const before = useUserStore.getState().userState;

    getUserState.mockResolvedValue(payload());
    await act(() => useUserStore.getState().refreshUserState());

    expect(useUserStore.getState().userState).toBe(before);
  });

  it('drops the previous identity’s bootstrap on a cache-scope switch', async () => {
    const getUserState = vi
      .spyOn(userService, 'getUserState')
      .mockResolvedValue(payload({ userId: 'user-a' }));
    const { rerender } = renderSync();
    await waitFor(() => expect(useUserStore.getState().isUserStateInit).toBe(true));

    // Switch identity: the new scope's response is still in flight.
    useScope('user-b:personal');
    getUserState.mockImplementation(pending);
    rerender();

    expect(useUserStore.getState().isUserStateInit).toBe(false);
    expect(useUserStore.getState().userState).toBeUndefined();
  });

  it('records the init error and settles it once a retry succeeds', async () => {
    const getUserState = vi
      .spyOn(userService, 'getUserState')
      .mockRejectedValueOnce(new Error('boom'));
    renderSync();

    await waitFor(() => expect(useUserStore.getState().isUserStateInitError).toBeInstanceOf(Error));
    expect(useUserStore.getState().isUserStateInit).toBe(false);

    getUserState.mockResolvedValue(payload());
    await act(() => useUserStore.getState().refreshUserState());

    await waitFor(() => expect(useUserStore.getState().isUserStateInit).toBe(true));
    expect(useUserStore.getState().isUserStateInitError).toBeUndefined();
  });
});
