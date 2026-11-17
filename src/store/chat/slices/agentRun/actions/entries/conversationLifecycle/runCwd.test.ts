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

const existingTopic = {
  metadata: { boundDeviceId: 'dev-1', workingDirectoryConfig: worktree },
};

describe('resolveSendRunCwd with a pinned worktree', () => {
  it('starts a Desktop API-bound session in its newly created checkout', async () => {
    const result = await resolveSendRunCwd({
      ...base,
      agencyConfig: { executionTarget: 'local' },
      draftWorkingDirectory: worktree,
      heterogeneousProvider: { authMode: 'api', type: 'claude-code' },
      inheritedTopic: { metadata: { workingDirectoryConfig: { path: '/code/old' } } },
      stagedDirectoryPath: worktree.path,
    });

    expect(result.workingDirectoryConfig).toEqual(worktree);
    expect(result.workingDirectory).toBe(worktree.sessionPath);
  });

  it('keeps a device-bound topic in its saved worktree', async () => {
    const result = await resolveSendRunCwd({ ...base, existingTopic });

    expect(result.runCwdDeviceId).toBe('dev-1');
    expect(result.workingDirectoryConfig).toEqual(worktree);
    expect(result.workingDirectory).toBe(worktree.git!.activeWorktree);
  });

  it('continues a local CLI agent’s session in the same worktree', async () => {
    const result = await resolveSendRunCwd({
      ...base,
      existingTopic,
      heterogeneousProvider: { type: 'claude-code' },
    });

    expect(result.workingDirectory).toBe(worktree.git!.activeWorktree);
  });

  it('keeps an existing topic’s worktree instead of taking a staged project directory', async () => {
    const result = await resolveSendRunCwd({
      ...base,
      existingTopic,
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
      existingTopic,
    });

    expect(result.workingDirectoryConfig).toEqual({ path: '/code/other' });
    expect(result.workingDirectory).toBe('/code/other');
  });

  it('keeps the agent default for topics without a pinned directory', async () => {
    const result = await resolveSendRunCwd(base);
    expect(result.workingDirectoryConfig).toEqual({ path: '/code/lobehub' });
  });
});
