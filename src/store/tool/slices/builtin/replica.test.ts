/**
 * @vitest-environment happy-dom
 *
 * The uninstalled-builtin-tools list is a replica: it paints the persisted copy
 * on the first frame, the network only confirms, and an install / uninstall
 * shows in the view immediately — rolling back when the server rejects it.
 */
import { randomUUID } from 'node:crypto';

import { defaultUninstalledBuiltinTools, onDemandBuiltinToolIds } from '@lobechat/builtin-tools';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as workspaceHooks from '@/business/client/hooks/useActiveWorkspaceId';
import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { userService } from '@/services/user';

import { useToolStore } from '../../store';
import { initialBuiltinToolState } from './initialState';
import {
  installedImplicitBuiltinSkillIds,
  UNINSTALLED_BUILTIN_TOOLS_KEY,
  uninstalledBuiltinToolsResource,
} from './projection';

vi.mock('@/services/user', () => ({
  userService: {
    getUserState: vi.fn(),
    updateUninstalledBuiltinTools: vi.fn(),
  },
}));

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

const userState = (tool: unknown) => ({ settings: { tool } }) as any;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {}) as Promise<any>;

const STORAGE_KEY = uninstalledBuiltinToolsResource.storageKey({ workspaceId: null });

describe('uninstalled builtin tools replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`builtin-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialBuiltinToolState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        uninstalledBuiltinToolsResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('waits for confirmed settings and reuses them across sends in the same scope', async () => {
    const settings = Promise.withResolvers<ReturnType<typeof userState>>();
    vi.mocked(userService.getUserState).mockReturnValue(settings.promise);
    const read = useToolStore.getState().getUninstalledBuiltinToolsForRun;
    const first = read();
    const second = read();
    settings.resolve(userState({ uninstalledBuiltinTools: ['lobe-calculator'] }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      ['lobe-calculator'],
      ['lobe-calculator'],
    ]);
    await expect(read()).resolves.toEqual(['lobe-calculator']);
    expect(userService.getUserState).toHaveBeenCalledTimes(1);
  });

  it('only offers installed legacy skills after confirming the current scope', async () => {
    const skills = (createdAt: string) =>
      installedImplicitBuiltinSkillIds(useToolStore.getState(), createdAt, undefined);
    const oldAgent = '2026-11-01T00:00:00Z';
    expect(skills(oldAgent)).toEqual([]);
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['lobe-agent-browser'] }),
    );
    await useToolStore.getState().getUninstalledBuiltinToolsForRun();
    expect(skills(oldAgent)).toContain('lobe-artifacts');
    expect(skills(oldAgent)).not.toContain('lobe-agent-browser');
    expect(skills('2026-11-18T15:53:51Z')).toEqual([]);
    useScope(`other-${randomUUID()}:personal`);
    expect(skills(oldAgent)).toEqual([]);
  });

  it('withholds on-demand tools after a failed read and retries on the next send', async () => {
    vi.mocked(userService.getUserState)
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValueOnce(userState({ uninstalledBuiltinTools: [] }));
    const read = useToolStore.getState().getUninstalledBuiltinToolsForRun;
    await expect(read()).resolves.toEqual(onDemandBuiltinToolIds);
    await expect(read()).resolves.toEqual([]);
  });

  it('discards the settings response when the active scope changes during a send', async () => {
    const settings = Promise.withResolvers<ReturnType<typeof userState>>();
    vi.mocked(userService.getUserState).mockReturnValue(settings.promise);
    const pendingRead = useToolStore.getState().getUninstalledBuiltinToolsForRun();
    useScope(`other-${randomUUID()}:personal`);
    settings.resolve(userState({ uninstalledBuiltinTools: [] }));
    await expect(pendingRead).resolves.toEqual(onDemandBuiltinToolIds);
  });

  it('paints the persisted list before the network answers', async () => {
    await uninstalledBuiltinToolsResource.storage!.set(
      { queryKey: STORAGE_KEY, scope },
      { data: ['lobe-gone'], updatedAt: 1 },
    );
    vi.mocked(userService.getUserState).mockImplementation(pending);

    const sync = renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), {
      wrapper,
    });

    await waitFor(() =>
      expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['lobe-gone']),
    );
    expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(true);
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('falls back to the default seed while nothing has been persisted yet', async () => {
    vi.mocked(userService.getUserState).mockImplementation(pending);

    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(defaultUninstalledBuiltinTools);
    // No persisted copy and no server answer yet: the view is still un-painted.
    expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(false);
  });

  it('replaces the list with the server response and persists it', async () => {
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['p1'] }),
    );

    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), { wrapper });

    await waitFor(() => expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['p1']));
    await waitFor(async () =>
      expect(
        (await uninstalledBuiltinToolsResource.storage!.get({ queryKey: STORAGE_KEY, scope }))
          ?.data,
      ).toEqual(['p1']),
    );
  });

  it('resolves the per-workspace slot when a workspace is active', async () => {
    vi.spyOn(workspaceHooks, 'useActiveWorkspaceId').mockReturnValue('ws-1');
    vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({
        uninstalledBuiltinTools: ['personal-tool'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['ws-tool'] },
      }),
    );

    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['ws-tool']),
    );
  });

  it('drops the previous identity’s list before the next one paints', async () => {
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['lobe-gone'] }),
    );

    const sync = renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), {
      wrapper,
    });
    await waitFor(() =>
      expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['lobe-gone']),
    );

    vi.mocked(userService.getUserState).mockImplementation(pending);
    useScope(`builtin-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(false));
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(defaultUninstalledBuiltinTools);
  });

  it('does not fetch while the sync is disabled', async () => {
    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(userService.getUserState).not.toHaveBeenCalled();
    expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(false);
  });

  it('shows the new list optimistically, then confirms from the server', async () => {
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['a', 'b'] }),
    );
    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), { wrapper });
    await waitFor(() =>
      expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['a', 'b']),
    );

    let resolveWrite!: (value: unknown) => void;
    const updateSpy = vi
      .mocked(userService.updateUninstalledBuiltinTools)
      .mockImplementation(() => new Promise((resolve) => (resolveWrite = resolve)) as any);

    const operation = useToolStore.getState().installBuiltinTool('a');
    // The overlay is visible before the server answers.
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['b']);

    await expect(useToolStore.getState().getUninstalledBuiltinToolsForRun()).resolves.toEqual([
      'a',
      'b',
    ]);

    // The refresh that follows the write sees the server's new state.
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['b'] }),
    );
    await act(async () => {
      resolveWrite(undefined);
      await operation;
    });
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['b']);
    await expect(useToolStore.getState().getUninstalledBuiltinToolsForRun()).resolves.toEqual([
      'b',
    ]);
  });

  it('shows a toggle immediately even before the replica has painted', async () => {
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['a', 'b'] }),
    );

    let resolveWrite!: (value: unknown) => void;
    const updateSpy = vi
      .mocked(userService.updateUninstalledBuiltinTools)
      .mockImplementation(() => new Promise((resolve) => (resolveWrite = resolve)) as any);

    // The replica has never painted (no storage row, no server answer yet).
    expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(false);

    const operation = useToolStore.getState().installBuiltinTool('a');
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    // The freshly-read list became the base, so the overlay is visible.
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['b']);

    await act(async () => {
      resolveWrite(undefined);
      await operation;
    });
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['b']);
  });

  it('does not paint or persist a toggle whose identity changed while it read the server', async () => {
    // Nothing is persisted and no server answer has landed, so the replica has
    // not painted: the toggle takes the "adopt the freshly-read list" path that
    // seeds the replica before the optimistic overlay.
    expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(false);

    // The toggle's own server read hangs until we release it.
    let resolveState!: (value: unknown) => void;
    vi.mocked(userService.getUserState).mockImplementation(
      () => new Promise((resolve) => (resolveState = resolve)) as any,
    );
    vi.mocked(userService.updateUninstalledBuiltinTools).mockResolvedValue(undefined as any);

    const operation = useToolStore.getState().installBuiltinTool('a');

    // The user switches workspace while the server read is in flight.
    const switched = `builtin-user-${randomUUID()}:personal`;
    useScope(switched);

    await act(async () => {
      resolveState(userState({ uninstalledBuiltinTools: ['a', 'b'] }));
      await operation;
    });

    // The server write stays pinned to the scope the toggle started in ...
    expect(userService.updateUninstalledBuiltinTools).toHaveBeenCalledWith(['b'], null);
    // ... while the switched-to scope is neither painted nor persisted with the
    // previous identity's list.
    expect(useToolStore.getState().isUninstalledBuiltinToolsInit).toBe(false);
    expect(useToolStore.getState().uninstalledBuiltinTools).not.toEqual(['b']);
    expect(
      (
        await uninstalledBuiltinToolsResource.storage!.get({
          queryKey: STORAGE_KEY,
          scope: switched,
        })
      )?.data,
    ).toBeUndefined();
  });

  it('rolls the list back when the server rejects the write', async () => {
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['a', 'b'] }),
    );
    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), { wrapper });
    await waitFor(() =>
      expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['a', 'b']),
    );

    vi.mocked(userService.updateUninstalledBuiltinTools).mockRejectedValue(new Error('boom'));

    await expect(useToolStore.getState().installBuiltinTool('a')).rejects.toThrow('boom');

    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['a', 'b']);
  });

  it('revalidates through refreshUninstalledBuiltinTools without clearing the list', async () => {
    vi.mocked(userService.getUserState).mockResolvedValue(
      userState({ uninstalledBuiltinTools: ['a'] }),
    );
    renderHook(() => useToolStore((s) => s.useFetchUninstalledBuiltinTools)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['a']));

    expect(UNINSTALLED_BUILTIN_TOOLS_KEY).toBe('uninstalled');
    await act(async () => {
      await useToolStore.getState().refreshUninstalledBuiltinTools();
    });
    // The list survived the revalidation round-trip.
    expect(useToolStore.getState().uninstalledBuiltinTools).toEqual(['a']);
  });
});
