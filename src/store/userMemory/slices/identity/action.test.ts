/**
 * @vitest-environment happy-dom
 *
 * Action-level behaviour of the identity slice: the CRUD paths revalidate the
 * replica list instead of hand-resetting it, the injection identities sync
 * through their own replica, and a purge clears both views through the engine.
 */
import { randomUUID } from 'node:crypto';

import type { IdentityForInjection, IdentityListItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { identitySelectors, useUserMemoryStore } from '@/store/userMemory';

import { identityInitialState } from './initialState';
import { globalIdentitiesResource, identityListResource } from './projection';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const identity = (id: string): IdentityListItem => ({
  capturedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  description: null,
  episodicDate: null,
  id,
  relationship: 'self',
  role: null,
  tags: null,
  title: id,
  type: 'personal',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const injection = (id: string): IdentityForInjection => ({
  capturedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  description: null,
  id,
  role: null,
  type: 'personal',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

/** One `queryIdentities` response (the service envelope, not the replica view). */
const pageOf = (items: IdentityListItem[]) => ({
  items,
  page: 1,
  pageSize: 12,
  total: items.length,
});

const PARAMS = { pageSize: 12 };
const LIST_KEY = identityListResource.storageKey(PARAMS);
const INJECTION_KEY = globalIdentitiesResource.storageKey({});

const state = () => useUserMemoryStore.getState();

describe('identity slice actions', () => {
  const scopes = new Set<string>();
  let scope = '';

  beforeEach(() => {
    scope = `identity-action-${randomUUID()}:personal`;
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    useUserMemoryStore.setState({ ...identityInitialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all([
      ...[...scopes].map((value) =>
        identityListResource.storage!.remove({ queryKey: LIST_KEY, scope: value }),
      ),
      ...[...scopes].map((value) =>
        globalIdentitiesResource.storage!.remove({ queryKey: INJECTION_KEY, scope: value }),
      ),
    ]);
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('revalidates the list after creating an identity', async () => {
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(pageOf([identity('i1')]));
    vi.spyOn(memoryCRUDService, 'createIdentity').mockResolvedValue({
      identity: { id: 'i1' },
    } as never);

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(state().identities).toHaveLength(1));
    const callsAfterHead = fetchSpy.mock.calls.length;

    await act(async () => {
      await state().createIdentity({ description: 'new' });
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterHead);
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 12 }));
  });

  it('revalidates the list after updating an identity', async () => {
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(pageOf([identity('i1')]));
    const updateSpy = vi.spyOn(memoryCRUDService, 'updateIdentity').mockResolvedValue(true);

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(state().identities).toHaveLength(1));
    const callsAfterHead = fetchSpy.mock.calls.length;

    await act(async () => {
      await state().updateIdentity('i1', { description: 'edited' });
    });

    expect(updateSpy).toHaveBeenCalledWith('i1', { description: 'edited' });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterHead);
  });

  it('syncs the self identities injected into the chat context', async () => {
    const injectionSpy = vi
      .spyOn(userMemoryService, 'queryIdentitiesForInjection')
      .mockResolvedValue([injection('i1')]);

    renderHook(() => useUserMemoryStore((s) => s.useInitIdentities)(true), { wrapper });

    await waitFor(() => expect(state().globalIdentitiesInit).toBe(true));
    expect(state().globalIdentities.map((item) => item.id)).toEqual(['i1']);
    expect(identitySelectors.hasGlobalIdentities(state())).toBe(true);
    expect(injectionSpy).toHaveBeenCalledWith({ limit: 25 });
  });

  it('does not request injection identities when signed out', () => {
    const injectionSpy = vi
      .spyOn(userMemoryService, 'queryIdentitiesForInjection')
      .mockResolvedValue([injection('i1')]);

    renderHook(() => useUserMemoryStore((s) => s.useInitIdentities)(false), { wrapper });

    expect(injectionSpy).not.toHaveBeenCalled();
    expect(state().globalIdentitiesInit).toBe(false);
  });

  it('clears both identity views (and their persisted rows) on reset', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(pageOf([identity('i1')]));
    vi.spyOn(userMemoryService, 'queryIdentitiesForInjection').mockResolvedValue([injection('i1')]);

    renderHook(
      () => ({
        list: useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS),
        injection: useUserMemoryStore((s) => s.useInitIdentities)(true),
      }),
      { wrapper },
    );
    await waitFor(() => expect(state().identities).toHaveLength(1));
    await waitFor(() => expect(state().globalIdentities).toHaveLength(1));

    act(() => {
      state().resetIdentities();
    });

    expect(state().identities).toEqual([]);
    expect(state().globalIdentities).toEqual([]);
    expect(identitySelectors.identitiesTotal(state())).toBe(0);
    // The removals are queued behind the write queue; wait for them to land.
    await waitFor(async () => {
      await expect(
        identityListResource.storage!.get({ queryKey: LIST_KEY, scope }),
      ).resolves.toBeUndefined();
      await expect(
        globalIdentitiesResource.storage!.get({ queryKey: INJECTION_KEY, scope }),
      ).resolves.toBeUndefined();
    });
  });
});
