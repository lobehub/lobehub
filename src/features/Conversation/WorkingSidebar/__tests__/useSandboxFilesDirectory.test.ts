import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SandboxSelection } from '@/features/ChatInput/ControlBar/useSandboxPlacement';

const state = vi.hoisted(() => ({
  fetchedInstance: [] as (string | undefined)[],
  instanceDirectory: undefined as string | null | undefined,
  placement: undefined as { mode: string } | null | undefined,
  selection: {} as SandboxSelection,
}));

vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: {
    resolveSessionPlacement: async () => state.placement,
  },
}));

vi.mock('@/features/ChatInput/ControlBar/useSandboxPlacement', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSandboxPlacement: () => ({ selection: state.selection }),
}));
vi.mock('@/store/sandbox', () => ({
  sandboxActions: {
    useFetchInstanceDirectory: (id?: string) => state.fetchedInstance.push(id),
  },
  sandboxSelectors: { instanceDirectory: (id?: string) => id },
  useSandboxStore: (instanceId?: string) => (instanceId ? state.instanceDirectory : undefined),
}));

const { useSandboxFilesDirectory } = await import('../useSandboxFilesDirectory');

// A fresh SWR cache per render, so one case's placement never answers another's.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const renderLive = (options: { isSandboxTarget: boolean; topicId?: string | null }) =>
  renderHook(() => useSandboxFilesDirectory('agent-1', options), { wrapper }).result;

const render = (options: { isSandboxTarget: boolean; topicId?: string | null }) =>
  renderLive(options).current;

describe('useSandboxFilesDirectory', () => {
  beforeEach(() => {
    state.fetchedInstance = [];
    state.instanceDirectory = undefined;
    state.placement = { mode: 'drive' };
    state.selection = {};
  });

  it("shows a temporary sandbox's own tree, through the conversation's session", () => {
    expect(render({ isSandboxTarget: true, topicId: 'tpc_1' })).toEqual({
      active: true,
      directory: '',
      directoryKnown: true,
      ephemeral: true,
      instanceId: undefined,
      topicId: 'tpc_1',
    });
    // A temporary sandbox has no environment directory to look up.
    expect(state.fetchedInstance.every((id) => id === undefined)).toBe(true);
  });

  it('shows nothing for a temporary sandbox before the conversation exists', () => {
    expect(render({ isSandboxTarget: true, topicId: null })).toMatchObject({
      active: false,
      ephemeral: false,
      topicId: undefined,
    });
  });

  it('keeps a folder on the drive on the drive', () => {
    state.selection = { workingDirectory: 'reports' };

    expect(render({ isSandboxTarget: true, topicId: 'tpc_1' })).toEqual({
      active: true,
      directory: 'reports',
      directoryKnown: true,
      ephemeral: false,
      instanceId: undefined,
      topicId: 'tpc_1',
    });
  });

  it('waits for a legacy environment directory to resolve', () => {
    state.selection = { instanceId: 'inst-1' };

    expect(render({ isSandboxTarget: true, topicId: 'tpc_1' })).toMatchObject({
      active: true,
      directoryKnown: false,
      ephemeral: false,
      instanceId: 'inst-1',
    });
    expect(state.fetchedInstance).toContain('inst-1');
  });

  it('stays out of the way when the run is not in the cloud sandbox', () => {
    expect(render({ isSandboxTarget: false, topicId: 'tpc_1' })).toMatchObject({
      active: false,
      ephemeral: false,
      topicId: undefined,
    });
  });

  it('shows the temporary sandbox the run actually fell back to', async () => {
    // The picked folder was deleted: the run resolves to a temporary sandbox.
    state.selection = { workingDirectory: 'gone' };
    state.placement = { mode: 'ephemeral' };

    const result = renderLive({ isSandboxTarget: true, topicId: 'tpc_1' });
    // Until the resolver answers, the pick stands.
    expect(result.current).toMatchObject({ directory: 'gone', ephemeral: false });

    await waitFor(() => expect(result.current).toMatchObject({ directory: '', ephemeral: true }));
  });

  it('reads a pick without a drive (no entitlement) as a temporary sandbox', async () => {
    state.selection = { workingDirectory: 'reports' };
    state.placement = null;

    const result = renderLive({ isSandboxTarget: true, topicId: 'tpc_1' });

    await waitFor(() => expect(result.current).toMatchObject({ ephemeral: true }));
  });
});
