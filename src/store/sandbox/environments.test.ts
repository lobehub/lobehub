/**
 * @vitest-environment happy-dom
 *
 * The environments page's pools (`all` / `public` / `private`) are one
 * `local-replica` resource shared with the composer's picker: a reload paints
 * the stored rows while the network confirms them, configuration never reaches
 * storage, writes land on the replica and its storage, and scopes stay apart.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { environmentService } from '@/services/environment';

import { sandboxActions } from './action';
import { initialState } from './initialState';
import { type SandboxEnvironment, sandboxEnvironmentsResource } from './projection';
import { sandboxSelectors } from './selectors';
import { useSandboxStore } from './store';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

type Listed = Awaited<ReturnType<typeof environmentService.listEnvironments>>;

const raw = (overrides: Record<string, unknown> = {}) => ({
  configuration: {
    bootstrapCommand: 'pnpm install',
    env: { API_TOKEN: 'secret-value' },
    sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub.git' }],
  },
  createdAt: new Date('2026-10-01T00:00:00Z'),
  creator: { avatar: null, fullName: 'Ada', id: 'user-1', username: 'ada' },
  description: 'Main repo',
  id: 'env-1',
  name: 'Lobehub Dev',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  userId: 'user-1',
  visibility: 'private',
  workspaceId: 'ws-1',
  ...overrides,
});

const listed = (...environments: ReturnType<typeof raw>[]) =>
  ({ environments }) as unknown as Listed;

const storedRow = (overrides: Partial<SandboxEnvironment> = {}): SandboxEnvironment => ({
  createdAt: '2026-10-01T00:00:00.000Z',
  creator: { avatar: null, fullName: 'Ada', id: 'user-1', username: 'ada' },
  description: 'Main repo',
  id: 'env-1',
  kind: 'code',
  name: 'Lobehub Dev',
  repository: 'lobehub/lobehub',
  userId: 'user-1',
  visibility: 'private',
  workspaceId: 'ws-1',
  ...overrides,
});

const POOLS = ['all', 'public', 'private'] as const;
const state = () => useSandboxStore.getState();

describe('sandbox environments replica', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const seed = (pool: (typeof POOLS)[number], data: SandboxEnvironment[], at = scope) =>
    sandboxEnvironmentsResource.storage!.set({ queryKey: pool, scope: at }, { data, updatedAt: 1 });

  const stored = async (pool: (typeof POOLS)[number]) =>
    (await sandboxEnvironmentsResource.storage!.get({ queryKey: pool, scope }))?.data;

  beforeEach(() => {
    useScope(`env-user-${randomUUID()}:ws-1`);
    useSandboxStore.setState({ ...initialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        POOLS.map((queryKey) =>
          sandboxEnvironmentsResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  it('paints a pool from storage before the network answers, then takes the server answer', async () => {
    await seed('private', [storedRow()]);
    let answer!: (value: Listed) => void;
    const listEnvironments = vi
      .spyOn(environmentService, 'listEnvironments')
      .mockImplementation(() => new Promise<Listed>((resolve) => (answer = resolve)));

    renderHook(() => sandboxActions.useFetchEnvironments('private'), { wrapper });

    await waitFor(() =>
      expect(sandboxSelectors.environments('private')(state())?.[0].name).toBe('Lobehub Dev'),
    );
    // Restored, not confirmed: no configuration and no server answer yet.
    expect(sandboxSelectors.environments('private')(state())?.[0].configuration).toBeUndefined();
    expect(sandboxSelectors.isEnvironmentsConfirmed('private')(state())).toBe(false);
    expect(listEnvironments).toHaveBeenCalledWith({ visibility: 'private' });

    await act(async () => answer(listed(raw({ name: 'Renamed' }))));

    await waitFor(() =>
      expect(sandboxSelectors.environments('private')(state())?.[0].name).toBe('Renamed'),
    );
    expect(sandboxSelectors.isEnvironmentsConfirmed('private')(state())).toBe(true);
    expect(sandboxSelectors.environments('private')(state())?.[0].configuration).toMatchObject({
      bootstrapCommand: 'pnpm install',
    });
  });

  it('keeps configuration (env, source URLs) out of storage', async () => {
    vi.spyOn(environmentService, 'listEnvironments').mockResolvedValue(
      listed(
        raw(),
        raw({
          configuration: {
            sources: [{ kind: 'git', url: 'https://x-access-token:ghp_secret@github.com/a/b.git' }],
          },
          id: 'env-2',
        }),
      ),
    );

    renderHook(() => sandboxActions.useFetchEnvironments(), { wrapper });

    await waitFor(async () => expect(await stored('all')).toHaveLength(2));
    const rows = (await stored('all'))!;
    expect(rows[0]).toEqual(storedRow());
    // A URL carrying a token is not a plain `owner/name`, so nothing of it is kept.
    expect(rows[1].repository).toBeUndefined();
    const payload = JSON.stringify(rows);
    for (const leaked of ['configuration', 'secret', 'ghp_', 'pnpm install', 'API_TOKEN']) {
      expect(payload).not.toContain(leaked);
    }
  });

  it('treats an empty list restored from storage as unconfirmed until the server answers', async () => {
    await seed('public', []);
    vi.spyOn(environmentService, 'listEnvironments').mockImplementation(pending);

    renderHook(() => sandboxActions.useFetchEnvironments('public'), { wrapper });

    await waitFor(() => expect(sandboxSelectors.environments('public')(state())).toEqual([]));
    expect(sandboxSelectors.isEnvironmentsConfirmed('public')(state())).toBe(false);
  });

  it('keeps the last list when a background refresh fails', async () => {
    vi.spyOn(environmentService, 'listEnvironments')
      .mockResolvedValueOnce(listed(raw()))
      .mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => sandboxActions.useFetchEnvironments('private'), {
      wrapper,
    });
    await waitFor(() => expect(sandboxSelectors.environments('private')(state())).toHaveLength(1));

    await act(async () => {
      await result.current.revalidate().catch(() => {});
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(sandboxSelectors.environments('private')(state())?.[0].name).toBe('Lobehub Dev');
  });

  it('serves the page and the picker from one request', async () => {
    const listEnvironments = vi
      .spyOn(environmentService, 'listEnvironments')
      .mockResolvedValue(listed(raw()));

    renderHook(
      () => {
        sandboxActions.useFetchEnvironments();
        sandboxActions.useFetchPickerEnvironments(true);
        sandboxActions.useFetchEnvironments();
      },
      { wrapper },
    );

    await waitFor(() => expect(sandboxSelectors.pickerEnvironments(state())).toHaveLength(1));
    expect(sandboxSelectors.environments()(state())).toBe(
      sandboxSelectors.pickerEnvironments(state()),
    );
    expect(listEnvironments).toHaveBeenCalledTimes(1);
  });

  it('does not show the previous identity its environments', async () => {
    const previous = scope;
    await seed('all', [storedRow({ name: 'Previous user env' })], previous);
    vi.spyOn(environmentService, 'listEnvironments').mockImplementation(pending);

    const { rerender } = renderHook(() => sandboxActions.useFetchEnvironments(), { wrapper });
    await waitFor(() =>
      expect(sandboxSelectors.environments()(state())?.[0].name).toBe('Previous user env'),
    );

    useScope(`env-user-${randomUUID()}:ws-2`);
    rerender();

    await waitFor(() => expect(sandboxSelectors.environments()(state())).toBeUndefined());
  });

  it('drops a removed environment from every pool and from storage, so a reload cannot restore it', async () => {
    vi.spyOn(environmentService, 'listEnvironments').mockImplementation(async (params) =>
      // The server still lists it until the delete lands.
      listed(raw({ visibility: params?.visibility ?? 'private' })),
    );
    vi.spyOn(environmentService, 'removeEnvironment').mockResolvedValue(undefined as never);

    const { unmount } = renderHook(
      () => {
        sandboxActions.useFetchEnvironments();
        sandboxActions.useFetchEnvironments('private');
      },
      { wrapper },
    );
    await waitFor(async () => expect(await stored('private')).toHaveLength(1));
    await waitFor(async () => expect(await stored('all')).toHaveLength(1));

    // The refresh after the delete has not answered yet.
    vi.mocked(environmentService.listEnvironments).mockImplementation(pending);
    await act(async () => {
      void sandboxActions.removeEnvironment('env-1');
    });

    await waitFor(() => expect(sandboxSelectors.environments('private')(state())).toEqual([]));
    expect(sandboxSelectors.environments()(state())).toEqual([]);
    await waitFor(async () => expect(await stored('private')).toEqual([]));
    await waitFor(async () => expect(await stored('all')).toEqual([]));

    // Reload: a fresh store hydrates the stored pool without the removed row.
    unmount();
    useSandboxStore.setState({ ...initialState });
    renderHook(() => sandboxActions.useFetchEnvironments('private'), { wrapper });
    await waitFor(() => expect(sandboxSelectors.environments('private')(state())).toEqual([]));
  });

  it('moves a published environment from the private pool into the public one', async () => {
    vi.spyOn(environmentService, 'listEnvironments').mockImplementation(async (params) =>
      params?.visibility === 'public' ? listed() : listed(raw()),
    );
    vi.spyOn(environmentService, 'setEnvironmentVisibility').mockResolvedValue({} as never);

    renderHook(
      () => {
        sandboxActions.useFetchEnvironments('private');
        sandboxActions.useFetchEnvironments('public');
      },
      { wrapper },
    );
    await waitFor(() => expect(sandboxSelectors.environments('private')(state())).toHaveLength(1));
    await waitFor(() => expect(sandboxSelectors.environments('public')(state())).toEqual([]));

    // The refresh after the write has not answered yet: the move is already there.
    vi.mocked(environmentService.listEnvironments).mockImplementation(pending);
    await act(async () => {
      void sandboxActions.setEnvironmentVisibility({ id: 'env-1', visibility: 'public' });
    });

    await waitFor(() => expect(sandboxSelectors.environments('private')(state())).toEqual([]));
    expect(sandboxSelectors.environments('public')(state())?.[0]).toMatchObject({
      id: 'env-1',
      visibility: 'public',
    });
    await waitFor(async () => expect(await stored('private')).toEqual([]));
  });

  it('writes an edited name through to every pool and storage', async () => {
    vi.spyOn(environmentService, 'listEnvironments').mockResolvedValue(listed(raw()));
    vi.spyOn(environmentService, 'updateEnvironment').mockResolvedValue({} as never);

    renderHook(() => sandboxActions.useFetchEnvironments('private'), { wrapper });
    await waitFor(() => expect(sandboxSelectors.environments('private')(state())).toHaveLength(1));

    vi.mocked(environmentService.listEnvironments).mockImplementation(pending);
    await act(async () => {
      void sandboxActions.updateEnvironment({ id: 'env-1', name: 'Renamed' });
    });

    await waitFor(() =>
      expect(sandboxSelectors.environments('private')(state())?.[0].name).toBe('Renamed'),
    );
    await waitFor(async () => expect((await stored('private'))?.[0].name).toBe('Renamed'));
  });
});
