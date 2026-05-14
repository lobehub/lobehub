import { describe, expect, it } from 'vitest';

import { buildGitStatusEntries } from '../useGitWorkingTreeFiles';

describe('buildGitStatusEntries', () => {
  it('maps working-tree file buckets to pierre/trees git status entries', () => {
    expect(
      buildGitStatusEntries({
        added: ['new.ts'],
        deleted: ['old.ts'],
        modified: ['changed.ts'],
      }),
    ).toEqual([
      { path: 'new.ts', status: 'added' },
      { path: 'changed.ts', status: 'modified' },
      { path: 'old.ts', status: 'deleted' },
    ]);
  });
});
