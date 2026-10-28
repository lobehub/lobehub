// Fixture: a forward guard that replica-owned data is not also persisted by the SWR tiers.
import { expect, it } from 'vitest';

import { CACHE_TIERS } from '@/libs/swr/localStorageProvider';

import { useGitStatusStore } from './store';

it('hydrates the branch from its replica entry', () => {
  useGitStatusStore.getState().hydrate({ gitBranch: { '/repo': { branch: 'main' } } });
  expect(useGitStatusStore.getState().gitBranchMap['/repo']).toEqual({ branch: 'main' });
});

// Replicas own this persistence: the SWR cache tiers must not also keep it.
it('is not persisted by the SWR cache layer', () => {
  const patterns = [...CACHE_TIERS.idb, ...CACHE_TIERS.local];
  for (const name of ['gitBranch', 'gitAheadBehind', 'gitWorkingTreeStatus']) {
    expect(patterns.some((pattern) => pattern.includes(name))).toBe(false);
  }
});
