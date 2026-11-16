import type { WorkingDirConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  applyBranchToConfig,
  applyWorktreeAddToConfig,
  applyWorktreeExitToConfig,
} from './worktreeConfigEffects';

/** A topic whose worktree the app created on its first send. */
const autoCreated: WorkingDirConfig = {
  git: {
    activeWorktree: '/wt/quiet-hill',
    autoCreated: true,
    autoCreatedAt: '2026-11-17T00:00:00.000Z',
    branch: 'lobehub/quiet-hill',
    isWorktree: true,
  },
  path: '/repo',
};

describe('the auto-created worktree marker', () => {
  it('stays while the topic is still on that worktree', () => {
    const next = applyBranchToConfig(autoCreated, '/repo', 'lobehub/renamed');
    expect(next.git).toMatchObject({
      autoCreated: true,
      autoCreatedAt: autoCreated.git!.autoCreatedAt,
    });
  });

  it('is dropped when an agent moves the topic to another worktree', () => {
    const next = applyWorktreeAddToConfig(autoCreated, '/repo', {
      branch: 'feat/x',
      path: '/wt/other',
    });
    expect(next.git?.activeWorktree).toBe('/wt/other');
    expect(next.git).not.toHaveProperty('autoCreated');
    expect(next.git).not.toHaveProperty('autoCreatedAt');
  });

  it('is dropped when the topic leaves the worktree', () => {
    const next = applyWorktreeExitToConfig(autoCreated, '/repo');
    expect(next.git).not.toHaveProperty('autoCreated');
    expect(next.git).not.toHaveProperty('activeWorktree');
  });
});
