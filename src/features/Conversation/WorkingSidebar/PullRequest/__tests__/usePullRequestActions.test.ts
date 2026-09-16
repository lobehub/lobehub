import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceKeys } from '@/libs/swr/keys';

import { usePullRequestActions } from '../usePullRequestActions';

const runPullRequestAction = vi.hoisted(() => vi.fn());
const pushGitBranch = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/services/git', () => ({ gitService: { pushGitBranch, runPullRequestAction } }));
vi.mock('@/libs/swr', () => ({ mutate }));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: toastError } }));

const params = { deviceId: 'dev-1', number: 7, workingDirectory: '/repo' };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('usePullRequestActions', () => {
  beforeEach(() => {
    runPullRequestAction.mockReset();
    pushGitBranch.mockReset();
    mutate.mockClear();
    toastError.mockReset();
  });

  it('marks busy during the action and clears it afterwards', async () => {
    const pending = deferred<{ success: boolean }>();
    runPullRequestAction.mockReturnValue(pending.promise);
    const { result } = renderHook(() =>
      usePullRequestActions({ ...params, mutateDetail: vi.fn().mockResolvedValue(undefined) }),
    );

    let run!: Promise<boolean>;
    act(() => {
      run = result.current.run({ admin: true, method: 'squash', type: 'merge' });
    });
    expect(result.current.busy).toBe('merge');
    expect(runPullRequestAction).toHaveBeenCalledWith({
      action: { admin: true, method: 'squash', type: 'merge' },
      deviceId: 'dev-1',
      number: 7,
      path: '/repo',
    });

    await act(async () => {
      pending.resolve({ success: true });
      await run;
    });
    expect(result.current.busy).toBeUndefined();
  });

  it('revalidates detail, linked PR, ahead/behind and working tree on success', async () => {
    runPullRequestAction.mockResolvedValue({ success: true });
    const mutateDetail = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullRequestActions({ ...params, mutateDetail }));

    await act(async () => {
      expect(await result.current.run({ type: 'ready' })).toBe(true);
    });

    expect(mutateDetail).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(deviceKeys.gitAheadBehind('dev-1', '/repo'));
    expect(mutate).toHaveBeenCalledWith(deviceKeys.gitWorkingTreeStatus('dev-1', '/repo'));
    const matcher = mutate.mock.calls.find(([key]) => typeof key === 'function')?.[0];
    expect(matcher(deviceKeys.gitLinkedPR('dev-1', '/repo', 'feat/x', 7))).toBe(true);
    expect(matcher(deviceKeys.gitLinkedPR('dev-1', '/other', 'feat/x'))).toBe(false);
  });

  it('keeps dock-action failures as error and retries the same action', async () => {
    runPullRequestAction.mockResolvedValueOnce({ error: 'base moved', success: false });
    const { result } = renderHook(() =>
      usePullRequestActions({ ...params, mutateDetail: vi.fn().mockResolvedValue(undefined) }),
    );

    await act(async () => {
      expect(await result.current.run({ method: 'rebase', type: 'merge' })).toBe(false);
    });
    expect(result.current.error).toBe('base moved');
    expect(mutate).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();

    runPullRequestAction.mockResolvedValueOnce({ success: true });
    await act(async () => {
      result.current.retry();
    });
    expect(runPullRequestAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: { method: 'rebase', type: 'merge' } }),
    );
    expect(result.current.error).toBeUndefined();
  });

  it('toasts non-dock failures without touching the dock error', async () => {
    runPullRequestAction.mockRejectedValueOnce(new Error('gh exploded'));
    const { result } = renderHook(() =>
      usePullRequestActions({ ...params, mutateDetail: vi.fn().mockResolvedValue(undefined) }),
    );

    await act(async () => {
      expect(await result.current.run({ body: 'hi', type: 'comment' })).toBe(false);
    });
    expect(toastError).toHaveBeenCalledWith('gh exploded');
    expect(result.current.error).toBeUndefined();
  });

  it('ignores re-entry while an action is in flight', async () => {
    const pending = deferred<{ success: boolean }>();
    runPullRequestAction.mockReturnValue(pending.promise);
    pushGitBranch.mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      usePullRequestActions({ ...params, mutateDetail: vi.fn().mockResolvedValue(undefined) }),
    );

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.run({ type: 'ready' });
      second = result.current.push();
    });
    expect(await second).toBe(false);
    expect(pushGitBranch).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ success: true });
      await first;
    });
    expect(result.current.busy).toBeUndefined();
  });
});
