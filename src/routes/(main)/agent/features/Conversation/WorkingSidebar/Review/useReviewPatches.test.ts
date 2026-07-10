import { mutate, useClientDataSWR } from '@/libs/swr';

import {
  getReviewRefreshInterval,
  invalidateGitReviewCaches,
  useReviewPatches,
} from './useReviewPatches';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/services/git', () => ({
  gitService: {
    getGitBranchDiff: vi.fn(),
    getGitWorkingTreePatches: vi.fn(),
    listGitRemoteBranches: vi.fn(),
  },
}));

describe('useReviewPatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('polls while the review tab is active and disables polling while hidden', () => {
    expect(getReviewRefreshInterval('unstaged', true)).toBe(10_000);
    expect(getReviewRefreshInterval('branch', true)).toBe(30_000);
    expect(getReviewRefreshInterval('unstaged', false)).toBe(0);

    useReviewPatches('/repo', 'unstaged', undefined, undefined, true);

    expect(useClientDataSWR).toHaveBeenCalledWith(
      ['device:gitReviewPatches', 'local', '/repo', 'unstaged', ''],
      expect.any(Function),
      expect.objectContaining({
        refreshInterval: 10_000,
        refreshWhenHidden: false,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
      }),
    );

    vi.clearAllMocks();

    useReviewPatches('/repo', 'branch', 'origin/canary', 'device-1', false);

    expect(useClientDataSWR).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.objectContaining({
        refreshInterval: 0,
      }),
    );
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
    expect(mutate).toHaveBeenNthCalledWith(2, ['device:gitWorkingTreeStatus', 'device-1', '/repo']);
    expect(mutate).toHaveBeenNthCalledWith(3, ['device:gitAheadBehind', 'device-1', '/repo']);
    expect(mutate).toHaveBeenNthCalledWith(4, [
      'localFile:gitWorkingTreeFiles',
      'device-1',
      '/repo',
    ]);
  });
});
