import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  resolveAgentWorkingDirectory,
  resolveAgentWorkingDirectoryConfig,
  resolveAgentWorkingDirectorySource,
  resolveTargetDeviceId,
} from './agentWorkingDirectory';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });

describe('resolveTargetDeviceId', () => {
  it('uses boundDeviceId when executionTarget is `device`', () => {
    expect(
      resolveTargetDeviceId(cfg({ boundDeviceId: 'dev-1', executionTarget: 'device' }), 'cur'),
    ).toBe('dev-1');
  });

  it('uses the current machine for non-device targets', () => {
    expect(resolveTargetDeviceId(cfg({ executionTarget: 'local' }), 'cur')).toBe('cur');
    expect(resolveTargetDeviceId(cfg({ executionTarget: 'sandbox' }), 'cur')).toBe('cur');
    expect(resolveTargetDeviceId(undefined, 'cur')).toBe('cur');
  });

  it('uses the synced local binding when no current machine id is available', () => {
    expect(
      resolveTargetDeviceId(cfg({ boundDeviceId: 'dev-1', executionTarget: 'local' }), undefined),
    ).toBe('dev-1');
  });

  it('does not use stale bindings for sandbox targets', () => {
    expect(
      resolveTargetDeviceId(cfg({ boundDeviceId: 'dev-1', executionTarget: 'sandbox' }), undefined),
    ).toBeUndefined();
  });

  it('returns undefined when device target has no boundDeviceId', () => {
    expect(resolveTargetDeviceId(cfg({ executionTarget: 'device' }), 'cur')).toBeUndefined();
  });
});

describe('resolveAgentWorkingDirectory', () => {
  it('follows precedence: topic > agentChoice > legacy > deviceDefault > fallback', () => {
    const base = {
      agencyConfig: cfg({ executionTarget: 'local', workingDirByDevice: { cur: '/agent' } }),
      currentDeviceId: 'cur',
      deviceDefaultCwd: '/device-default',
      fallback: '/home',
      legacyAgentWorkingDirectory: '/legacy',
      topicWorkingDirectory: '/topic',
    };
    expect(resolveAgentWorkingDirectory(base)).toBe('/topic');
    expect(resolveAgentWorkingDirectory({ ...base, topicWorkingDirectory: undefined })).toBe(
      '/agent',
    );
    expect(
      resolveAgentWorkingDirectory({
        ...base,
        agencyConfig: cfg({ executionTarget: 'local' }),
        topicWorkingDirectory: undefined,
      }),
    ).toBe('/legacy');
    expect(
      resolveAgentWorkingDirectory({
        ...base,
        agencyConfig: cfg({ executionTarget: 'local' }),
        legacyAgentWorkingDirectory: undefined,
        topicWorkingDirectory: undefined,
      }),
    ).toBe('/device-default');
    expect(
      resolveAgentWorkingDirectory({
        currentDeviceId: 'cur',
        fallback: '/home',
      }),
    ).toBe('/home');
  });

  it('keys the per-device choice by the bound device when target is `device`', () => {
    const agencyConfig = cfg({
      boundDeviceId: 'dev-1',
      executionTarget: 'device',
      workingDirByDevice: { 'cur': '/local-choice', 'dev-1': '/remote-choice' },
    });
    // resolves the bound device's path, not the current machine's
    expect(resolveAgentWorkingDirectory({ agencyConfig, currentDeviceId: 'cur' })).toBe(
      '/remote-choice',
    );
  });

  it('uses the active worktree from the per-device source entry as the effective cwd', () => {
    const agencyConfig = cfg({
      executionTarget: 'local',
      workingDirByDevice: {
        cur: {
          git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
          path: '/repo',
          repoType: 'git',
        },
      },
    });

    expect(resolveAgentWorkingDirectory({ agencyConfig, currentDeviceId: 'cur' })).toBe(
      '/repo-fix',
    );
  });

  it('ignores the per-device choice when the target device has no entry', () => {
    const agencyConfig = cfg({
      executionTarget: 'local',
      workingDirByDevice: { other: '/other-choice' },
    });
    expect(
      resolveAgentWorkingDirectory({
        agencyConfig,
        currentDeviceId: 'cur',
        deviceDefaultCwd: '/device-default',
      }),
    ).toBe('/device-default');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveAgentWorkingDirectory({})).toBeUndefined();
  });
});

describe('resolveAgentWorkingDirectorySource', () => {
  it('resolves to the SOURCE repo path, ignoring the active worktree', () => {
    // A worktree switch records `activeWorktree` but the directory label must
    // keep showing the repo root (where hetero CLI sessions actually anchor).
    const agencyConfig = cfg({
      executionTarget: 'local',
      workingDirByDevice: {
        cur: {
          git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
          path: '/repo',
          repoType: 'git',
        },
      },
    });

    expect(resolveAgentWorkingDirectorySource({ agencyConfig, currentDeviceId: 'cur' })).toBe(
      '/repo',
    );
    // the effective resolver still yields the worktree — the two intentionally
    // diverge, and git status (not the directory label) is what consumes it.
    expect(resolveAgentWorkingDirectory({ agencyConfig, currentDeviceId: 'cur' })).toBe(
      '/repo-fix',
    );
  });

  it('resolves the topic-level config to its source path', () => {
    expect(
      resolveAgentWorkingDirectorySource({
        topicWorkingDirectory: '/topic-effective',
        topicWorkingDirectoryConfig: {
          git: { activeWorktree: '/repo-fix', isWorktree: true },
          path: '/repo',
        },
      }),
    ).toBe('/repo');
  });
});

describe('resolveAgentWorkingDirectoryConfig', () => {
  it('keeps the topic-level rich config as a single structured directory', () => {
    const topicWorkingDirectoryConfig = {
      git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
      path: '/repo',
      repoType: 'git' as const,
    };

    expect(
      resolveAgentWorkingDirectoryConfig({
        agencyConfig: cfg({ workingDirByDevice: { cur: '/agent' } }),
        currentDeviceId: 'cur',
        topicWorkingDirectory: '/repo-fix',
        topicWorkingDirectoryConfig,
      }),
    ).toEqual(topicWorkingDirectoryConfig);
  });

  it('returns the agent rich entry so new topics can snapshot it', () => {
    const agentChoice = {
      git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
      path: '/repo',
      repoType: 'git' as const,
    };
    const agencyConfig = cfg({
      executionTarget: 'local',
      workingDirByDevice: { cur: agentChoice },
    });

    expect(resolveAgentWorkingDirectoryConfig({ agencyConfig, currentDeviceId: 'cur' })).toEqual(
      agentChoice,
    );
  });
});
