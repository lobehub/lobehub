/**
 * @vitest-environment happy-dom
 *
 * The Agent Run verify card (`verifyRunMap`) is a replica persisted to
 * IndexedDB for settled runs only: a reload paints the last verdict before the
 * network answers, while a run that is still moving never lands in storage.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyResults, useVerifyState } from '@/features/Acceptance/hooks';
import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { verifyService } from '@/services/verify';

import { useVerifyStore } from './index';
import { initialState } from './initialState';
import { verifyRunResource, type VerifyRunSnapshot } from './projection';

const OP = 'op-1';

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

const run = (verifyStatus: string, resultStatus = 'passed'): VerifyRunSnapshot =>
  ({
    results: [{ checkItemId: 'item-1', id: 'result-1', status: resultStatus }],
    state: {
      verifyPlan: [{ id: 'item-1', title: 'Renders the card' }],
      verifyPlanConfirmedAt: null,
      verifyStatus,
    },
  }) as unknown as VerifyRunSnapshot;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const storage = verifyRunResource.storage!;

describe('verify run replica', () => {
  let scope = '';
  let stateSpy: ReturnType<typeof vi.spyOn>;
  let resultsSpy: ReturnType<typeof vi.spyOn>;

  const stored = async () => (await storage.get({ queryKey: OP, scope }))?.data;
  const persist = (data: VerifyRunSnapshot) =>
    storage.set({ queryKey: OP, scope }, { data, updatedAt: 1 });
  const serve = (data: VerifyRunSnapshot) => {
    stateSpy.mockResolvedValue(data.state as never);
    resultsSpy.mockResolvedValue(data.results as never);
  };

  beforeEach(() => {
    scope = `verify-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    stateSpy = vi.spyOn(verifyService, 'getVerifyState');
    resultsSpy = vi.spyOn(verifyService, 'listResults');
    act(() => useVerifyStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    await storage.remove({ queryKey: OP, scope });
    await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    vi.restoreAllMocks();
  });

  it('paints a persisted settled run before the network answers, then refreshes it', async () => {
    await persist(run('failed', 'failed'));
    let release!: (value: unknown) => void;
    stateSpy.mockImplementation(() => new Promise((resolve) => (release = resolve)) as never);
    resultsSpy.mockResolvedValue(run('passed').results as never);

    const { result } = renderHook(
      () => ({ results: useVerifyResults(OP).data, state: useVerifyState(OP).data }),
      { wrapper },
    );

    // The card has its last verdict on the first painted frame after reload.
    await waitFor(() => expect(result.current.state?.verifyStatus).toBe('failed'));
    expect(result.current.results?.[0]?.status).toBe('failed');

    // The background revalidation then replaces it with the server's answer.
    await act(async () => release(run('passed').state));
    await waitFor(() => expect(result.current.state?.verifyStatus).toBe('passed'));
    expect(result.current.results?.[0]?.status).toBe('passed');
  });

  it('pre-hydrates a persisted run into the view before any card mounts', async () => {
    await persist(run('passed'));

    await useVerifyStore.getState().preHydrateVerifyRuns([OP, 'op-missing']);

    expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('passed');
    expect(useVerifyStore.getState().verifyRunMap['op-missing']).toBeUndefined();
  });

  it('persists a settled run fetched from the server', async () => {
    serve(run('passed'));

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() => expect(useVerifyStore.getState().verifyRunMap[OP]).toBeDefined());
    await waitFor(async () => expect((await stored())?.state?.verifyStatus).toBe('passed'));
  });

  it('keeps a run that is still verifying memory-only', async () => {
    serve(run('verifying', 'running'));

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('verifying'),
    );
    // Give the write queue a turn: nothing may land for an unsettled run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await stored()).toBeUndefined();
  });

  it('keeps a failed run that is about to auto-repair memory-only', async () => {
    const autoRepair = run('failed', 'failed');
    autoRepair.state!.verifyPlan = [
      { id: 'item-1', onFail: 'auto_repair', required: true, title: 'Renders the card' },
    ] as never;
    serve(autoRepair);

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('failed'),
    );
    // The server flips this run to `repairing` next: its verdict must not replay.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await stored()).toBeUndefined();
  });

  it('persists a failed auto-repair run once the server declined the repair', async () => {
    const declined = run('failed', 'failed');
    declined.state!.verifyPlan = [
      { id: 'item-1', onFail: 'auto_repair', required: true, title: 'Renders the card' },
    ] as never;
    // Repair cap reached / superseded / no spawner: the failure is the final verdict.
    declined.state!.verifyAutoRepair = 'declined';
    serve(declined);

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(async () => expect((await stored())?.state?.verifyStatus).toBe('failed'));
  });

  it('does not persist a settled status paired with results that are still pending', async () => {
    // State and results are two requests: a check can finish between them, so
    // the terminal status may arrive with the pre-commit pending rows.
    const torn = run('passed', 'pending');
    torn.state!.verifyPlan = [{ id: 'item-1', required: true, title: 'Renders the card' }] as never;
    serve(torn);

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('passed'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await stored()).toBeUndefined();
  });

  it('does not persist a settled status missing a required result', async () => {
    const missing = run('failed', 'failed');
    missing.state!.verifyPlan = [
      { id: 'item-1', onFail: 'manual', required: true, title: 'Renders the card' },
      { id: 'item-2', onFail: 'manual', required: true, title: 'Not reported yet' },
    ] as never;
    serve(missing);

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('failed'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await stored()).toBeUndefined();
  });

  it('keeps an unsettled run out of the replica index', async () => {
    serve(run('verifying', 'running'));

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('verifying'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A ghost index key would count toward `persist.maxEntries` and evict real rows.
    const index = (await storage.get({ queryKey: REPLICA_INDEX_KEY, scope }))?.data as unknown;
    expect((index as string[] | undefined) ?? []).not.toContain(OP);
  });

  it('persists a failed run whose failed checks are manual', async () => {
    const manual = run('failed', 'failed');
    manual.state!.verifyPlan = [
      { id: 'item-1', onFail: 'manual', required: true, title: 'Renders the card' },
    ] as never;
    serve(manual);

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(async () => expect((await stored())?.state?.verifyStatus).toBe('failed'));
  });

  it('drops the persisted row of a settled run that starts repairing', async () => {
    await persist(run('failed', 'failed'));
    serve(run('repairing', 'failed'));

    renderHook(() => useVerifyStore.getState().useFetchVerifyRun(OP), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().verifyRunMap[OP]?.state?.verifyStatus).toBe('repairing'),
    );
    await waitFor(async () => expect(await stored()).toBeUndefined());
  });

  it('does not fetch without an operation id', () => {
    stateSpy.mockImplementation(pending);
    renderHook(() => useVerifyState(null), { wrapper });
    expect(stateSpy).not.toHaveBeenCalled();
  });
});
