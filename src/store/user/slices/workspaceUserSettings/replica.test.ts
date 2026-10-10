/**
 * @vitest-environment happy-dom
 *
 * The workspace-user preference bucket is a `@lobechat/replica` resource whose
 * view is the user store's flat `workspaceUserPreference` field (+ the
 * `workspaceUserPreferenceWorkspaceId` loaded marker): a persisted projection
 * paints while the network confirms it, personal mode never hits the network,
 * and a cache-scope switch drops the previous workspace's bucket before paint —
 * applying a foreign workspace's overrides would route the wrong model / device.
 */
import { randomUUID } from 'node:crypto';

import type { WorkspaceUserPreference } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';
import { useUserStore } from '@/store/user';

import { initialWorkspaceUserSettingsState } from './initialState';
import { getWorkspaceUserPreferenceResource } from './projection';

// The OSS build stubs the active-workspace hook to `null`; workspace behaviour
// only exists where a workspace is active, so drive it with a controllable id.
const active = vi.hoisted(() => ({ id: 'ws-1' as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => active.id,
  useActiveWorkspaceId: () => active.id,
}));

vi.mock('@/services/workspaceUserSettings', () => ({
  workspaceUserSettingsService: {
    getPreference: vi.fn(),
    updatePreference: vi.fn(),
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

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const state = () => useUserStore.getState();
const resource = getWorkspaceUserPreferenceResource();
const storageKey = resource.storageKey({ workspaceId: 'ws-1' });
const entry = (workspaceId: string) => state().workspaceUserPreferenceReplica.entries[workspaceId];

const renderSync = () =>
  renderHook(() => useUserStore((s) => s.useFetchWorkspaceUserPreference)(), { wrapper });

describe('workspace user preference replica', () => {
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
    active.id = 'ws-1';
    useScope(`wp-user-${randomUUID()}:ws-1`);
    useUserStore.setState({ ...initialWorkspaceUserSettingsState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) => resource.storage!.remove({ queryKey: storageKey, scope: value })),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('fetches the active workspace preference and paints the view', async () => {
    const preference: WorkspaceUserPreference = {
      agentModelOverrides: { a1: { model: 'gpt-5', provider: 'openai' } },
    };
    vi.mocked(workspaceUserSettingsService.getPreference).mockResolvedValue(preference);

    const { result } = renderSync();

    await waitFor(() => expect(state().workspaceUserPreference).toEqual(preference));
    expect(state().workspaceUserPreferenceWorkspaceId).toBe('ws-1');
    expect(entry('ws-1').source).toBe('server');
    expect(workspaceUserSettingsService.getPreference).toHaveBeenCalledTimes(1);

    // The hook keeps the shape the consumers expect: `data` is the loaded view.
    expect(result.current.data).toEqual(preference);
    expect(result.current.isLoading).toBe(false);
  });

  it('paints the persisted projection before the network answers', async () => {
    await resource.storage!.set(
      { queryKey: storageKey, scope },
      { data: { agentModeOverrides: { a1: true } }, updatedAt: 1 },
    );
    vi.mocked(workspaceUserSettingsService.getPreference).mockImplementation(pending);

    renderSync();

    await waitFor(() => expect(state().workspaceUserPreferenceWorkspaceId).toBe('ws-1'));
    expect(state().workspaceUserPreference).toEqual({ agentModeOverrides: { a1: true } });
    expect(entry('ws-1').source).toBe('storage');
  });

  it('reads a null server row as a loaded, empty bucket', async () => {
    // A workspace with no row yet: the server answers `null`.
    vi.mocked(workspaceUserSettingsService.getPreference).mockResolvedValue(
      null as unknown as WorkspaceUserPreference,
    );

    renderSync();

    await waitFor(() => expect(state().workspaceUserPreferenceWorkspaceId).toBe('ws-1'));
    expect(state().workspaceUserPreference).toEqual({});
    expect(entry('ws-1').source).toBe('server');
  });

  it('never hits the network in personal mode (no active workspace)', async () => {
    active.id = null;

    const { result } = renderSync();
    await act(async () => {});

    expect(workspaceUserSettingsService.getPreference).not.toHaveBeenCalled();
    expect(state().workspaceUserPreferenceWorkspaceId).toBeNull();
    expect(state().workspaceUserPreference).toEqual({});
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('drops the previous workspace bucket on a scope switch, before paint', async () => {
    vi.mocked(workspaceUserSettingsService.getPreference).mockResolvedValue({
      agentModeOverrides: { a1: true },
    });
    const { rerender } = renderSync();
    await waitFor(() => expect(state().workspaceUserPreferenceWorkspaceId).toBe('ws-1'));

    // Switch workspace: the new scope's read is still in flight.
    const user = scope.split(':')[0];
    useScope(`${user}:ws-2`);
    active.id = 'ws-2';
    vi.mocked(workspaceUserSettingsService.getPreference).mockImplementation(pending);
    rerender();

    expect(state().workspaceUserPreference).toEqual({});
    expect(state().workspaceUserPreferenceWorkspaceId).toBeNull();
  });

  it('optimistically merges a write into the view and rolls it back on failure', async () => {
    vi.mocked(workspaceUserSettingsService.getPreference).mockResolvedValue({
      agentModeOverrides: { existing: true },
    });
    vi.mocked(workspaceUserSettingsService.updatePreference).mockResolvedValue(undefined);
    renderSync();
    await waitFor(() =>
      expect(state().workspaceUserPreference.agentModeOverrides).toEqual({ existing: true }),
    );

    await act(() =>
      state().updateWorkspaceUserPreference({ agentModeOverrides: { selected: false } }),
    );

    // The sibling override survives the optimistic merge (server-side deep merge).
    expect(state().workspaceUserPreference.agentModeOverrides).toEqual({
      existing: true,
      selected: false,
    });
    expect(workspaceUserSettingsService.updatePreference).toHaveBeenCalledWith({
      agentModeOverrides: { selected: false },
    });

    // A failed write returns the view to the pre-write bucket.
    vi.mocked(workspaceUserSettingsService.updatePreference).mockRejectedValue(new Error('nope'));
    await act(async () => {
      await expect(
        state().updateWorkspaceUserPreference({ agentModeOverrides: { boom: true } }),
      ).rejects.toThrow('nope');
    });

    expect(state().workspaceUserPreference.agentModeOverrides).toEqual({
      existing: true,
      selected: false,
    });
  });
});
