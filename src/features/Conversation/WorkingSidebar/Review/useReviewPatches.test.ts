import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';

import { mutate } from '@/libs/swr';
import { gitService } from '@/services/git';

import {
  getReviewRefreshInterval,
  invalidateGitReviewCaches,
  useReviewPatches,
} from './useReviewPatches';

const platform = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  get isDesktop() {
    return platform.isDesktop;
  },
}));

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal()),
  mutate: vi.fn(),
}));

const revalidateGitStatus = vi.hoisted(() => vi.fn());

vi.mock('@/store/device/gitStatus/store', () => ({
  useGitStatusStore: { getState: () => ({ revalidateGitStatus }) },
}));

vi.mock('@/services/git', () => ({
  gitService: {
    getGitBranchDiff: vi.fn(),
    getGitWorkingTreePatches: vi.fn(),
    listGitRemoteBranches: vi.fn(),
  },
}));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

describe('useReviewPatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.isDesktop = true;
    vi.mocked(gitService.getGitWorkingTreePatches).mockResolvedValue({ patches: [] } as any);
    vi.mocked(gitService.getGitBranchDiff).mockResolvedValue({ patches: [] } as any);
  });

  it('polls while the review tab is active and disables polling while hidden', () => {
    expect(getReviewRefreshInterval('unstaged', true)).toBe(10_000);
    expect(getReviewRefreshInterval('branch', true)).toBe(30_000);
    expect(getReviewRefreshInterval('unstaged', false)).toBe(0);
  });

  it('reads the working tree only while the review tab is active', async () => {
    const hidden = renderHook(
      () => useReviewPatches('/repo', 'branch', 'origin/canary', 'device-1', false),
      { wrapper },
    );
    expect(hidden.result.current.data).toBeUndefined();
    expect(hidden.result.current.isLoading).toBe(false);
    hidden.unmount();
    expect(gitService.getGitBranchDiff).not.toHaveBeenCalled();

    renderHook(() => useReviewPatches('/repo', 'unstaged', undefined, undefined, true), {
      wrapper,
    });
    await waitFor(() =>
      expect(gitService.getGitWorkingTreePatches).toHaveBeenCalledWith({
        deviceId: undefined,
        path: '/repo',
      }),
    );
  });

  it('keeps the last diff without reading while the review tab is inactive', async () => {
    vi.mocked(gitService.getGitWorkingTreePatches).mockResolvedValue({
      patches: [{ path: 'kept.ts' }],
    } as any);
    const { result, rerender } = renderHook(
      ({ active }) => useReviewPatches('/kept-repo', 'unstaged', undefined, undefined, active),
      { initialProps: { active: true }, wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data;
    const reads = vi.mocked(gitService.getGitWorkingTreePatches).mock.calls.length;

    rerender({ active: false });
    expect(result.current.data).toBe(data);
    expect(result.current.isLoading).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gitService.getGitWorkingTreePatches).toHaveBeenCalledTimes(reads);
  });

  it('does not request local git patches from a web client without a target device', async () => {
    platform.isDesktop = false;

    const { result } = renderHook(
      () => useReviewPatches('/repo', 'unstaged', undefined, undefined, true),
      { wrapper },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.data).toBeUndefined();
    expect(gitService.getGitWorkingTreePatches).not.toHaveBeenCalled();
  });

  it('invalidates review patches and related git tree status caches together', async () => {
    await invalidateGitReviewCaches({
      baseRef: 'origin/canary',
      deviceId: 'device-1',
      dirPath: '/repo',
      mode: 'branch',
    });

    expect(mutate).toHaveBeenNthCalledWith(1, [
      'device:gitReviewPatches',
      'device-1',
      '/repo',
      'branch',
      'origin/canary',
    ]);
    expect(revalidateGitStatus).toHaveBeenCalledWith('device-1', '/repo', [
      'workingTreeStatus',
      'aheadBehind',
    ]);
    expect(mutate).toHaveBeenNthCalledWith(2, [
      'localFile:gitWorkingTreeFiles',
      'device-1',
      '/repo',
    ]);
  });
});
