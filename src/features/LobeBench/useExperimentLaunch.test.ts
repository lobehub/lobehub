import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createExperimentLaunch, experimentLaunchKey } from './experimentLaunch';
import { useExperimentLaunch } from './useExperimentLaunch';

const options = { benchmarkId: 'bench-1', userId: 'user-1', workspaceId: null as string | null };
const key = experimentLaunchKey({ benchmarkId: 'bench-1', userId: 'user-1', workspaceId: null });
const snapshot = () => ({
  benchmarkId: 'bench-1',
  contenders: [{ config: { model: 'm' }, id: 'c-a', name: 'A' }],
  datasetId: 'ds-1',
  metadata: { contenders: [{ id: 'c-a' }] },
  name: 'A',
});

describe('useExperimentLaunch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('begins a launch, keeps it across remounts, and clears only that experiment', async () => {
    const launch = createExperimentLaunch(snapshot());
    const first = renderHook(() => useExperimentLaunch(options));
    await waitFor(() => expect(first.result.current.ready).toBe(true));

    await act(async () => {
      expect(await first.result.current.begin(launch)).toEqual({ ok: true });
    });
    expect(first.result.current.launch).toEqual(launch);

    const second = renderHook(() => useExperimentLaunch(options));
    await waitFor(() => expect(second.result.current.launch).toEqual(launch));

    await act(async () => {
      expect(await second.result.current.clear('exp_other')).toBe(false);
    });
    expect(second.result.current.launch).toEqual(launch);
    await act(async () => {
      expect(await second.result.current.clear(launch.experimentId)).toBe(true);
    });
    expect(second.result.current.launch).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('does not overwrite a launch another tab began, and shows that one instead', async () => {
    const theirs = createExperimentLaunch(snapshot());
    localStorage.setItem(key, JSON.stringify(theirs));
    const { result } = renderHook(() => useExperimentLaunch(options));
    await waitFor(() => expect(result.current.launch).toEqual(theirs));

    const mine = createExperimentLaunch(snapshot());
    await act(async () => {
      expect(await result.current.begin(mine)).toEqual({
        existing: theirs,
        ok: false,
        reason: 'occupied',
      });
    });
    expect(result.current.launch).toEqual(theirs);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(theirs);
  });

  it('follows storage events from other tabs', async () => {
    const { result } = renderHook(() => useExperimentLaunch(options));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.launch).toBeUndefined();

    const theirs = createExperimentLaunch(snapshot());
    localStorage.setItem(key, JSON.stringify(theirs));
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: localStorage.getItem(key) }),
      );
    });
    await waitFor(() => expect(result.current.launch).toEqual(theirs));
  });

  it('reports a storage failure instead of claiming a checkpoint', async () => {
    const { result } = renderHook(() => useExperimentLaunch(options));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await act(async () => {
      expect(await result.current.begin(createExperimentLaunch(snapshot()))).toEqual({
        ok: false,
        reason: 'storage',
      });
    });
    expect(result.current.launch).toBeUndefined();
  });
});

describe('useExperimentLaunch.resume', () => {
  it('runs one resume at a time in this tab: a second call while one is in flight is busy', async () => {
    const { result } = renderHook(() => useExperimentLaunch(options));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.resume('exp_1', async () => {
        await gate;
        return 'first';
      });
      second = result.current.resume('exp_1', async () => 'second');
      await expect(second).resolves.toEqual({ ran: false, reason: 'busy' });
      release();
      await expect(first).resolves.toEqual({ ran: true, result: 'first' });
    });
  });
});
