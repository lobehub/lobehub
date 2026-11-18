/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scmKeys } from '@/libs/swr/keys';

import { useAutoFixToggle } from '../useAutoFixToggle';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(async () => undefined),
  refreshTopicPullRequests: vi.fn(async () => undefined),
  setChangeRequestAutoFix: vi.fn(async () => ({ autoFix: true, maxWakes: 3, wakeCount: 0 })),
}));

vi.mock('@/libs/swr', () => ({ mutate: mocks.mutate }));
vi.mock('@/services/scm', () => ({
  scmService: { setChangeRequestAutoFix: mocks.setChangeRequestAutoFix },
}));
vi.mock('@/services/work', () => ({
  workService: { refreshTopicPullRequests: mocks.refreshTopicPullRequests },
}));

const setup = (
  { changeRequestId }: { changeRequestId?: string } = { changeRequestId: 'scr-1' },
) => {
  const onFailed = vi.fn();
  const hook = renderHook(() => useAutoFixToggle({ changeRequestId, onFailed, topicId: 'tpc-1' }));
  return { hook, onFailed };
};

describe('useAutoFixToggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves, then refreshes the PR list and whether the open topic can be woken', async () => {
    const { hook, onFailed } = setup();

    await act(() => hook.result.current.toggle(true));

    expect(mocks.setChangeRequestAutoFix).toHaveBeenCalledWith({
      changeRequestId: 'scr-1',
      enabled: true,
    });
    expect(mocks.refreshTopicPullRequests).toHaveBeenCalledWith('tpc-1');
    // Without this, an idle open topic keeps its cached "nothing can wake me"
    // and misses the next GitHub wake until focus or remount.
    expect(mocks.mutate).toHaveBeenCalledWith(scmKeys.wakeTarget('tpc-1'));
    expect(onFailed).not.toHaveBeenCalled();
    expect(hook.result.current.pending).toBeUndefined();
  });

  it('shows the new state until the refreshed list carries it', async () => {
    let release!: () => void;
    mocks.refreshTopicPullRequests.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (release = () => resolve(undefined))),
    );
    const { hook } = setup();

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.toggle(false);
    });
    await vi.waitFor(() => expect(mocks.refreshTopicPullRequests).toHaveBeenCalled());
    expect(hook.result.current.pending).toBe(false);

    await act(async () => {
      release();
      await done;
    });
    expect(hook.result.current.pending).toBeUndefined();
  });

  it('puts the state back and reports a save that failed, refreshing nothing', async () => {
    mocks.setChangeRequestAutoFix.mockRejectedValueOnce(new Error('forbidden'));
    const { hook, onFailed } = setup();

    await act(() => hook.result.current.toggle(false));

    expect(onFailed).toHaveBeenCalledWith(false);
    expect(hook.result.current.pending).toBeUndefined();
    expect(mocks.refreshTopicPullRequests).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('does nothing where Auto-fix cannot be switched', async () => {
    const { hook } = setup({});

    await act(() => hook.result.current.toggle(true));

    expect(mocks.setChangeRequestAutoFix).not.toHaveBeenCalled();
  });
});
