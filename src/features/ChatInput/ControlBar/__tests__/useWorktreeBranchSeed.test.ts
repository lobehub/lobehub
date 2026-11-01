import type { DeviceGitBranchListItem } from '@lobechat/types';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gitService } from '@/services/git';

import { useWorktreeBranchSeed } from '../useWorktreeBranchSeed';

const branch = (name: string): DeviceGitBranchListItem => ({ current: false, name });

let listGitBranches: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  listGitBranches = vi.spyOn(gitService, 'listGitBranches');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = (path: string) => renderHook(() => useWorktreeBranchSeed('device-1', path)).result;

describe('useWorktreeBranchSeed', () => {
  // Regression: the default name is drawn against the repo's branch list, and
  // that list arrives asynchronously. Drawing while the read is still in flight
  // makes it look like "no branches", so a repo whose refs include a branch
  // literally called `wt` was handed `wt/...` and git refused creation with
  // `cannot lock ref 'refs/heads/wt/...': 'refs/heads/wt' exists`.
  it('hands out no name while the branch list is still being read', () => {
    listGitBranches.mockImplementation(() => new Promise(() => {}));

    const result = seed('/repo/cold-cache');

    expect(result.current.isReady).toBe(false);
    expect(result.current.name).toBeUndefined();
  });

  it('avoids the wt/ namespace once a ref on it has been seen', async () => {
    listGitBranches.mockResolvedValue([branch('main'), branch('wt')]);

    const result = seed('/repo/taken-namespace');

    await waitFor(() => expect(result.current.isReady).toBe(true));
    // Only a list that actually contains `wt` produces the flat form, so this
    // value proves the occupying ref reached the draw.
    expect(result.current.name).toMatch(/^wt-\d{12}-[a-z]+-[a-z]+$/);
  });

  it('keeps the wt/ namespace when nothing occupies it', async () => {
    listGitBranches.mockResolvedValue([branch('main'), branch('canary')]);

    const result = seed('/repo/free-namespace');

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.name).toMatch(/^wt\/\d{12}-[a-z]+-[a-z]+$/);
  });
});
