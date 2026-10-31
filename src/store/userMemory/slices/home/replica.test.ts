/**
 * @vitest-environment happy-dom
 *
 * The memory home reads (persona + identity roles/tags) are two
 * `local-replica` single-value resources: the persisted copy paints before
 * the network answers, the response confirms and persists it, a server
 * `null` persona is a real (persisted) absence, an unchanged revalidation does
 * not repaint, and the persona delete drops the value from the view and the
 * persisted projection.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';

import { initialState } from '../../initialState';
import { useUserMemoryStore } from '../../store';
import { identityScopeOf } from '../../utils/replica';
import {
  type HomeReplicaParams,
  IDENTITY_ROLES_KEY,
  identityRolesResource,
  PERSONA_KEY,
  personaResource,
} from './projection';

const PARAMS = {} as HomeReplicaParams;
const PERSONA_STORAGE_KEY = personaResource.storageKey(PARAMS);
const ROLES_STORAGE_KEY = identityRolesResource.storageKey(PARAMS);

const persona = { content: 'My persona', summary: 'Summary' };
const roles = { roles: [{ count: 3, role: 'engineer' }], tags: [{ count: 2, tag: 'typescript' }] };

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

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

describe('userMemory home replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  /** Storage partition of userMemory replicas: the user, not the workspace. */
  let rowScope = '';
  let personaSpy: ReturnType<typeof vi.spyOn>;
  let rolesSpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    rowScope = identityScopeOf(scope);
    scopes.add(rowScope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`home-user-${randomUUID()}:personal`);
    personaSpy = vi.spyOn(userMemoryService, 'getPersona');
    rolesSpy = vi.spyOn(userMemoryService, 'queryIdentityRoles');
    act(() => useUserMemoryStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [PERSONA_STORAGE_KEY, ROLES_STORAGE_KEY].map((queryKey) =>
          Promise.all([
            personaResource.storage!.remove({ queryKey, scope: value }),
            identityRolesResource.storage!.remove({ queryKey, scope: value }),
          ]),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('backs each home read with one fixed scope entry', () => {
    expect(PERSONA_KEY).toBe('persona');
    expect(IDENTITY_ROLES_KEY).toBe('identityRoles');
  });

  describe('persona', () => {
    it('paints the persisted persona before the network answers', async () => {
      await personaResource.storage!.set(
        { queryKey: PERSONA_STORAGE_KEY, scope: rowScope },
        { data: { persona }, updatedAt: 1 },
      );
      personaSpy.mockImplementation(pending);

      renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });

      await waitFor(() => expect(useUserMemoryStore.getState().persona).toEqual(persona));
      expect(useUserMemoryStore.getState().personaInit).toBe(true);
      // The value can only have come from the persisted replica.
      expect(personaSpy).toHaveBeenCalled();
    });

    it('confirms the server persona and persists it', async () => {
      personaSpy.mockResolvedValue(persona);

      renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });

      await waitFor(() => expect(useUserMemoryStore.getState().persona).toEqual(persona));
      expect(useUserMemoryStore.getState().personaData).toEqual({ persona });
      expect(useUserMemoryStore.getState().personaInit).toBe(true);

      await waitFor(async () => {
        const row = await personaResource.storage!.get({
          queryKey: PERSONA_STORAGE_KEY,
          scope: rowScope,
        });
        expect(row?.data).toEqual({ persona });
      });
    });

    it('treats a server null persona as a persisted absence, not a missing entry', async () => {
      personaSpy.mockResolvedValue(null);

      renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });

      await waitFor(() =>
        expect(useUserMemoryStore.getState().personaData).toEqual({ persona: null }),
      );
      expect(useUserMemoryStore.getState().persona).toBeUndefined();
      // Loaded-but-empty stays distinguishable from never-fetched.
      expect(useUserMemoryStore.getState().personaInit).toBe(true);

      await waitFor(async () => {
        const row = await personaResource.storage!.get({
          queryKey: PERSONA_STORAGE_KEY,
          scope: rowScope,
        });
        expect(row?.data).toEqual({ persona: null });
      });
    });

    it('drops the persona from the view and the persisted row on refresh', async () => {
      personaSpy.mockResolvedValue(null);
      // Mount the SWR provider the scoped `mutate` inside refreshPersona needs.
      renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });
      useUserMemoryStore.setState({ persona, personaData: { persona }, personaInit: true });

      await act(async () => {
        await useUserMemoryStore.getState().refreshPersona();
      });

      expect(useUserMemoryStore.getState().persona).toBeUndefined();
      expect(useUserMemoryStore.getState().personaData).toEqual({ persona: null });

      await waitFor(async () => {
        const row = await personaResource.storage!.get({
          queryKey: PERSONA_STORAGE_KEY,
          scope: rowScope,
        });
        expect(row?.data).toEqual({ persona: null });
      });
    });

    it('clears the persona of the account that deleted it, not the account switched to', async () => {
      const rowOf = (scopeValue: string) =>
        personaResource.storage!.get({ queryKey: PERSONA_STORAGE_KEY, scope: scopeValue });
      // The deleting account has a persisted persona.
      personaSpy.mockResolvedValue(persona);
      const first = renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });
      await waitFor(async () => expect((await rowOf(rowScope))?.data).toEqual({ persona }));
      first.unmount();
      const deletingUser = rowScope;

      // The DELETE is slow; the account switches while it runs.
      let finishDelete!: () => void;
      vi.spyOn(memoryCRUDService, 'deletePersona').mockImplementation(
        () => new Promise((resolve) => (finishDelete = () => resolve({ success: true }))) as never,
      );
      let deleting!: Promise<void>;
      act(() => {
        deleting = useUserMemoryStore.getState().deletePersona();
      });
      await waitFor(() => expect(finishDelete).toBeTypeOf('function'));

      const otherPersona = { content: 'Other persona', summary: 'Other' };
      useScope(`home-user-${randomUUID()}:personal`);
      personaSpy.mockResolvedValue(otherPersona);
      renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });
      await waitFor(() => expect(useUserMemoryStore.getState().persona).toEqual(otherPersona));

      await act(async () => {
        finishDelete();
        await deleting;
      });

      // The deleting account's persisted persona is gone...
      await waitFor(async () => expect(await rowOf(deletingUser)).toBeUndefined());
      // ...and the account on screen keeps its own.
      expect(useUserMemoryStore.getState().persona).toEqual(otherPersona);
      await waitFor(async () =>
        expect((await rowOf(rowScope))?.data).toEqual({ persona: otherPersona }),
      );
    });

    it('does not report loading until a replica value exists', async () => {
      let resolvePersona: (value: typeof persona | null) => void = () => {};
      personaSpy.mockImplementation(() => new Promise((resolve) => (resolvePersona = resolve)));

      const hook = renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(), { wrapper });

      // No persisted row and no response yet: loading.
      expect(hook.result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePersona(null);
      });

      await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    });

    it('does not fetch while disabled', async () => {
      personaSpy.mockResolvedValue(persona);

      const hook = renderHook(() => useUserMemoryStore((s) => s.useFetchPersona)(false), {
        wrapper,
      });

      expect(hook.result.current.isLoading).toBe(false);
      expect(personaSpy).not.toHaveBeenCalled();
    });
  });

  describe('identity roles + tags', () => {
    it('paints the persisted roles/tags before the network answers', async () => {
      await identityRolesResource.storage!.set(
        { queryKey: ROLES_STORAGE_KEY, scope: rowScope },
        { data: roles, updatedAt: 1 },
      );
      rolesSpy.mockImplementation(pending);

      renderHook(() => useUserMemoryStore((s) => s.useFetchTags)(), { wrapper });

      await waitFor(() =>
        expect(useUserMemoryStore.getState().roles).toEqual([{ count: 3, tag: 'engineer' }]),
      );
      expect(useUserMemoryStore.getState().tags).toEqual([{ count: 2, tag: 'typescript' }]);
      expect(useUserMemoryStore.getState().tagsInit).toBe(true);
    });

    it('maps role -> tag, persists, and does not repaint an unchanged response', async () => {
      rolesSpy.mockResolvedValue(roles);

      const hook = renderHook(() => useUserMemoryStore((s) => s.useFetchTags)(), { wrapper });

      await waitFor(() =>
        expect(useUserMemoryStore.getState().roles).toEqual([{ count: 3, tag: 'engineer' }]),
      );
      expect(useUserMemoryStore.getState().tags).toEqual([{ count: 2, tag: 'typescript' }]);

      await waitFor(async () => {
        const row = await identityRolesResource.storage!.get({
          queryKey: ROLES_STORAGE_KEY,
          scope: rowScope,
        });
        expect(row?.data).toEqual(roles);
      });

      const first = useUserMemoryStore.getState().identityRolesData;
      await act(async () => {
        await hook.result.current.mutate();
      });

      // Same server value -> the replica keeps the same view object.
      expect(useUserMemoryStore.getState().identityRolesData).toBe(first);
      expect(rolesSpy).toHaveBeenCalledTimes(2);
    });
  });
  describe('purge all memories', () => {
    it('replaces the persisted home rows with empty values even when home is not mounted', async () => {
      personaSpy.mockResolvedValue(persona);
      rolesSpy.mockResolvedValue(roles);
      vi.spyOn(memoryCRUDService, 'deleteAll').mockResolvedValue(undefined as never);

      const hook = renderHook(
        () => {
          useUserMemoryStore((s) => s.useFetchPersona)();
          useUserMemoryStore((s) => s.useFetchTags)();
        },
        { wrapper },
      );
      await waitFor(async () => {
        const personaRow = await personaResource.storage!.get({
          queryKey: PERSONA_STORAGE_KEY,
          scope: rowScope,
        });
        expect(personaRow?.data).toEqual({ persona });
        const rolesRow = await identityRolesResource.storage!.get({
          queryKey: ROLES_STORAGE_KEY,
          scope: rowScope,
        });
        expect(rolesRow?.data).toEqual(roles);
      });

      // Purge from another memory route: no home fetcher is mounted to refresh.
      hook.unmount();
      renderHook(() => null, { wrapper });

      await act(async () => {
        await useUserMemoryStore.getState().purgeAllMemories();
      });

      const state = useUserMemoryStore.getState();
      expect(state.persona).toBeUndefined();
      expect(state.personaData).toEqual({ persona: null });
      expect(state.personaInit).toBe(true);
      expect(state.roles).toEqual([]);
      expect(state.tags).toEqual([]);
      expect(state.tagsInit).toBe(true);

      await waitFor(async () => {
        const personaRow = await personaResource.storage!.get({
          queryKey: PERSONA_STORAGE_KEY,
          scope: rowScope,
        });
        expect(personaRow?.data).toEqual({ persona: null });
        const rolesRow = await identityRolesResource.storage!.get({
          queryKey: ROLES_STORAGE_KEY,
          scope: rowScope,
        });
        expect(rolesRow?.data).toEqual({ roles: [], tags: [] });
      });
    });
  });
});
