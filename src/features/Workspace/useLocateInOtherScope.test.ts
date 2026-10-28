/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOtherScopePath,
  probeScopes,
  SCOPE_PROBE_CONCURRENCY,
  SCOPE_PROBE_TIMEOUT_MS,
  useOtherScopeRecovery,
} from './useLocateInOtherScope';

const mocks = vi.hoisted(() => ({
  activeId: null as string | null,
  activeSlug: null as string | null,
  clients: [] as Array<string | null>,
  workspaces: [] as Array<{ id: string; name: string; slug: string }>,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeId,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeSlug,
}));
vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => mocks.workspaces,
}));
vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: (id: string | null) => {
    mocks.clients.push(id);
    return { scope: id };
  },
}));

const notFound = { data: { code: 'NOT_FOUND', httpStatus: 404 }, message: 'Goal not found' };
const TEAM = { id: 'ws_team', name: 'Project AIRI', slug: 'airi' };

/** The probe succeeds only through the client of `home` (null = personal). */
const probeLivingIn = (home: string | null) => async (client: any, _signal: AbortSignal) => {
  if (client.scope !== home) throw notFound;
};

const renderAt = (path: string, home: string | null, error: unknown = notFound) =>
  renderHook(() => useOtherScopeRecovery(error, `goal:${path}`, probeLivingIn(home)), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        createElement(MemoryRouter, { initialEntries: [path] }, children),
      ),
  });

beforeEach(() => {
  mocks.activeId = null;
  mocks.activeSlug = null;
  mocks.clients = [];
  mocks.workspaces = [TEAM];
});

describe('buildOtherScopePath', () => {
  it('drops the active slug when the target is personal', () => {
    expect(buildOtherScopePath('/airi/goal/g1', 'airi', {})).toBe('/goal/g1');
    expect(buildOtherScopePath('/airi/agent/a1/goal/g1', 'airi', {})).toBe('/agent/a1/goal/g1');
  });

  it('adds the target slug to a personal path', () => {
    expect(buildOtherScopePath('/goal/g1', null, { slug: 'airi' })).toBe('/airi/goal/g1');
  });

  it('swaps one workspace slug for another', () => {
    expect(buildOtherScopePath('/airi/goal/g1', 'airi', { slug: 'other' })).toBe('/other/goal/g1');
  });

  it('keeps a personal path that only starts with the active slug text', () => {
    expect(buildOtherScopePath('/airing/goal/g1', 'airi', {})).toBe('/airing/goal/g1');
  });
});

describe('useOtherScopeRecovery', () => {
  it('finds a personal goal opened in a team scope and targets the personal route', async () => {
    mocks.activeId = TEAM.id;
    mocks.activeSlug = TEAM.slug;

    const { result } = renderAt('/airi/goal/g1', null);

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.scope).toEqual({ id: null }));
    expect(result.current.targetPath).toBe('/goal/g1');
    expect(mocks.clients).toEqual([null]);
  });

  it('finds a team goal opened in the personal scope and targets the team route', async () => {
    const { result } = renderAt('/goal/g1', TEAM.id);

    await waitFor(() => expect(result.current.scope?.id).toBe(TEAM.id));
    expect(result.current.targetPath).toBe('/airi/goal/g1');
  });

  it('settles without a scope when no other scope has the goal', async () => {
    const { result } = renderAt('/goal/g1', 'ws_nowhere');

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.scope).toBeUndefined();
  });

  it('does not probe other scopes for errors other than 404', () => {
    const { result } = renderAt('/goal/g1', TEAM.id, { data: { httpStatus: 500 } });

    expect(result.current).toEqual({ pending: false });
    expect(mocks.clients).toEqual([]);
  });

  it('does not probe when the user has no other scope', () => {
    mocks.workspaces = [];

    const { result } = renderAt('/goal/g1', TEAM.id);

    expect(result.current).toEqual({ pending: false });
    expect(mocks.clients).toEqual([]);
  });
});

describe('probeScopes', () => {
  const scopes = [
    { id: null },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `ws_${i}`, slug: `ws-${i}` })),
  ];

  /** A probe that settles only when the test says so, recording every call. */
  const controlledProbe = () => {
    const calls: Array<{ id: string | null; signal: AbortSignal; settle: (ok: boolean) => void }> =
      [];
    const probe = (client: any, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          id: client.scope,
          settle: (ok) => (ok ? resolve() : reject(notFound)),
          signal,
        });
      });
    return { calls, probe };
  };

  it('keeps at most SCOPE_PROBE_CONCURRENCY probes in flight, personal first', async () => {
    const { calls, probe } = controlledProbe();
    const result = probeScopes(scopes, probe);

    await waitFor(() => expect(calls).toHaveLength(SCOPE_PROBE_CONCURRENCY));
    expect(calls.map((c) => c.id)).toEqual([null, 'ws_0', 'ws_1']);

    // A miss frees one slot for the next candidate, never more.
    calls[0].settle(false);
    await waitFor(() => expect(calls).toHaveLength(SCOPE_PROBE_CONCURRENCY + 1));
    expect(calls[3].id).toBe('ws_2');

    // The first hit aborts the probes still in flight and starts no more.
    calls[2].settle(true);
    await expect(result).resolves.toEqual(scopes[2]);
    expect(calls).toHaveLength(SCOPE_PROBE_CONCURRENCY + 1);
    expect(calls[1].signal.aborted).toBe(true);
    expect(calls[3].signal.aborted).toBe(true);
  });

  it('resolves null after every candidate misses', async () => {
    const probe = vi.fn(async () => {
      throw notFound;
    });

    await expect(probeScopes(scopes, probe)).resolves.toBeNull();
    expect(probe).toHaveBeenCalledTimes(scopes.length);
  });

  describe('when a probe never settles', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('treats the check as not found after SCOPE_PROBE_TIMEOUT_MS and aborts the probes', async () => {
      const { calls, probe } = controlledProbe();
      let result: unknown = 'pending';
      void probeScopes(scopes, probe).then((scope) => (result = scope));

      await vi.advanceTimersByTimeAsync(SCOPE_PROBE_TIMEOUT_MS - 1);
      expect(result).toBe('pending');
      expect(calls).toHaveLength(SCOPE_PROBE_CONCURRENCY);

      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBeNull();
      expect(calls.every((c) => c.signal.aborted)).toBe(true);
      expect(calls).toHaveLength(SCOPE_PROBE_CONCURRENCY);
    });
  });
});
