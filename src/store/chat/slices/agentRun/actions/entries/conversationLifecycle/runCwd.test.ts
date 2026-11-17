import type { WorkingDirConfig } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { resolveSendRunCwd } from './runCwd';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

const worktree: WorkingDirConfig = {
  git: {
    activeWorktree: '/Users/me/.lobehub/worktrees/lobehub-0000beef/quiet-hill',
    autoCreated: true,
    autoCreatedAt: '2026-11-17T00:00:00.000Z',
    branch: 'lobehub/quiet-hill',
  },
  path: '/code/lobehub',
  repoType: 'github',
  sessionPath: '/Users/me/.lobehub/worktrees/lobehub-0000beef/quiet-hill',
};

const base = {
  agencyConfig: {
    boundDeviceId: 'dev-1',
    executionTarget: 'device' as const,
    workingDirByDevice: { 'dev-1': { path: '/code/lobehub' } },
  },
  chatConfig: undefined,
  currentDeviceId: 'dev-local',
  existingTopic: undefined,
  heterogeneousProvider: undefined,
  inheritedTopic: undefined,
  isGatewayMode: true,
  legacyAgentWorkingDirectory: undefined,
  stagedDirectoryPath: undefined,
  workspaceScoped: false,
};

describe('resolveSendRunCwd with a directory prepared by the composer', () => {
  it('runs a new topic in the worktree made just before sending', async () => {
    const result = await resolveSendRunCwd({ ...base, draftWorkingDirectory: worktree });

    expect(result.runCwdDeviceId).toBe('dev-1');
    expect(result.workingDirectoryConfig).toEqual(worktree);
    expect(result.workingDirectory).toBe(worktree.git!.activeWorktree);
  });

  it('runs a local CLI agent in that worktree too: its session has not started yet', async () => {
    const result = await resolveSendRunCwd({
      ...base,
      draftWorkingDirectory: worktree,
      heterogeneousProvider: { type: 'claude-code' },
    });

    expect(result.workingDirectory).toBe(worktree.git!.activeWorktree);
  });

  it('outranks the staged project directory', async () => {
    const result = await resolveSendRunCwd({
      ...base,
      draftWorkingDirectory: worktree,
      stagedDirectoryPath: '/code/lobehub',
    });

    expect(result.workingDirectoryConfig).toEqual(worktree);
  });

  it('never moves an existing topic', async () => {
    const existingTopic = {
      metadata: { boundDeviceId: 'dev-1', workingDirectoryConfig: { path: '/code/other' } },
    };
    const result = await resolveSendRunCwd({
      ...base,
      draftWorkingDirectory: worktree,
      existingTopic,
    });

    expect(result.workingDirectoryConfig).toEqual({ path: '/code/other' });
    expect(result.workingDirectory).toBe('/code/other');
  });

  it('keeps the agent default without one', async () => {
    const result = await resolveSendRunCwd(base);
    expect(result.workingDirectoryConfig).toEqual({ path: '/code/lobehub' });
  });
});
