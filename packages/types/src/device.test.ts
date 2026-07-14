import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { WorkingDirConfig } from './device';
import { workingDirConfigSchema } from './device';

describe('workingDirConfigSchema', () => {
  /**
   * `WorkingDirConfig` is declared twice — once as the interface everything is typed
   * against, once as the zod schema the TRPC routes validate through. Zod STRIPS what
   * it does not declare, so a field added to only the interface type-checks perfectly
   * and is then silently dropped on every write. This pins the two together, and fails
   * to compile the moment they drift.
   */
  it('stays structurally identical to the WorkingDirConfig interface', () => {
    expectTypeOf<z.infer<typeof workingDirConfigSchema>>().toEqualTypeOf<WorkingDirConfig>();
  });

  it('preserves GitHub PR metadata under git.github', () => {
    const value = {
      git: {
        activeWorktree: '/repo-fix',
        branch: 'fix/worktree',
        github: {
          extraPullRequestCount: 1,
          pullRequest: {
            ciStatus: 'pending',
            isDraft: false,
            mergeStateStatus: 'CLEAN',
            mergeable: 'MERGEABLE',
            mergedAt: null,
            number: 123,
            reviewDecision: 'APPROVED',
            state: 'OPEN',
            title: 'Improve worktree handling',
            url: 'https://github.com/lobehub/lobehub/pull/123',
          },
          pullRequestStatus: 'ok',
        },
        isWorktree: true,
      },
      path: '/repo',
      repoType: 'github',
    };

    expect(workingDirConfigSchema.parse(value)).toEqual(value);
  });

  // The remote ref is the whole point of recording git state that outlives this
  // machine — and zod STRIPS what it does not declare, so a field missing from the
  // schema is not just unvalidated, it never survives a write at all.
  it('preserves the upstream remote ref under git.upstream', () => {
    const value = {
      git: {
        branch: 'worktree-feat+claude-code-session-import',
        upstream: { branch: 'feat/hetero-session-import-ui', remote: 'origin' },
      },
      path: '/repo',
      repoType: 'github',
    };

    expect(workingDirConfigSchema.parse(value)).toEqual(value);
  });
});
