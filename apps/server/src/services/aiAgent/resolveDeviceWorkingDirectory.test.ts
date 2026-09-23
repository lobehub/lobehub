import { describe, expect, it } from 'vitest';

import {
  resolveDeviceWorkingDirectory,
  resolveDeviceWorkingDirectoryConfig,
} from './resolveDeviceWorkingDirectory';

describe('resolveDeviceWorkingDirectory', () => {
  it('prefers the existing topic override above everything else', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        initialWorkingDirectory: '/initial',
        topicWorkingDirectory: '/topic',
        workingDirByDevice: { 'device-1': '/per-device' },
      }),
    ).toBe('/topic');
  });

  it('falls back to the brand-new-topic initial metadata when no topic override', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        initialWorkingDirectory: '/initial',
        workingDirByDevice: { 'device-1': '/per-device' },
      }),
    ).toBe('/initial');
  });

  it("uses the agent's per-device pick when no topic/initial cwd (the remote-CC new-topic case)", () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        workingDirByDevice: { 'device-1': '/per-device' },
      }),
    ).toBe('/per-device');
  });

  it('uses the active worktree from the per-device source entry as the effective cwd', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        workingDirByDevice: {
          'device-1': {
            git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
            path: '/repo',
            repoType: 'git',
          },
        },
      }),
    ).toBe('/repo-fix');
  });

  it('only matches the per-device pick for the dispatched device', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        deviceId: 'device-2',
        workingDirByDevice: { 'device-1': '/per-device' },
      }),
    ).toBe('/default');
  });

  it('falls back to the device default last', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        workingDirByDevice: {},
      }),
    ).toBe('/default');
  });

  it('returns undefined when nothing resolves', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceId: 'device-1',
        workingDirByDevice: {},
      }),
    ).toBeUndefined();
  });

  it('ignores the per-device map when no deviceId is given', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/default',
        workingDirByDevice: { 'device-1': '/per-device' },
      }),
    ).toBe('/default');
  });

  describe('[R3] a topic pin only applies on the device it belongs to', () => {
    const WELLS_LEGION = '838d6e154b6dbf342b9410cf58857a9d';
    const ITZC = '1aab3a739730a7db2f070246daa68be4';
    const UBUNTU = 'b06d4da75107ca3ed74ac3b35663d218';

    it("does not carry a Windows topic pin onto a Linux device over the agent's pick for it", () => {
      expect(
        resolveDeviceWorkingDirectory({
          deviceId: UBUNTU,
          devicePlatform: 'linux',
          topicWorkingDirectory: 'E:\\androidproject\\vrplayer',
          workingDirByDevice: { [UBUNTU]: { path: '/root/workspace/proxy' } },
        }),
      ).toBe('/root/workspace/proxy');
    });

    it('does not carry a pin from the device that bound the topic onto another device', () => {
      expect(
        resolveDeviceWorkingDirectory({
          deviceDefaultCwd: 'C:\\Users\\260622',
          deviceId: ITZC,
          devicePlatform: 'win32',
          topicDeviceId: WELLS_LEGION,
          topicWorkingDirectory: 'D:\\Sourcecode\\JuLink.W001',
          workingDirByDevice: { [WELLS_LEGION]: { path: 'D:\\Sourcecode\\JuLink.W001' } },
        }),
      ).toBe('C:\\Users\\260622');
    });

    it('keeps the pin on the device that bound the topic', () => {
      expect(
        resolveDeviceWorkingDirectory({
          deviceId: WELLS_LEGION,
          devicePlatform: 'win32',
          topicDeviceId: WELLS_LEGION,
          topicWorkingDirectory: 'D:\\Sourcecode\\JuLink.W001',
          workingDirByDevice: { [WELLS_LEGION]: { path: 'D:\\other' } },
        }),
      ).toBe('D:\\Sourcecode\\JuLink.W001');
    });

    it('keeps a pin with no recorded device when its path fits the device platform', () => {
      expect(
        resolveDeviceWorkingDirectory({
          deviceId: UBUNTU,
          devicePlatform: 'linux',
          topicWorkingDirectory: '/srv/app',
          workingDirByDevice: { [UBUNTU]: '/root/workspace/proxy' },
        }),
      ).toBe('/srv/app');
    });
  });

  it('treats null/undefined inputs as absent', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: null,
        deviceId: 'device-1',
        topicWorkingDirectory: undefined,
        workingDirByDevice: null,
      }),
    ).toBeUndefined();
  });
});

describe('resolveDeviceWorkingDirectoryConfig', () => {
  it('keeps topic rich config above all other sources', () => {
    const topicWorkingDirectoryConfig = {
      git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
      path: '/repo',
      repoType: 'git' as const,
    };

    expect(
      resolveDeviceWorkingDirectoryConfig({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        topicWorkingDirectory: '/repo-fix',
        topicWorkingDirectoryConfig,
        workingDirByDevice: { 'device-1': '/agent' },
      }),
    ).toEqual(topicWorkingDirectoryConfig);
  });

  it('returns the agent rich entry for new-topic backfill', () => {
    const agentChoice = {
      git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
      path: '/repo',
      repoType: 'git' as const,
    };

    expect(
      resolveDeviceWorkingDirectoryConfig({
        deviceDefaultCwd: '/default',
        deviceId: 'device-1',
        workingDirByDevice: { 'device-1': agentChoice },
      }),
    ).toEqual(agentChoice);
  });
});

describe('repo identifiers are never a device cwd', () => {
  const repos = ['lobehub/lobehub'];

  it('skips an initial repo-derived directory and falls through to the machine', () => {
    // A Task can carry a repo selection whose assignee agent is later switched
    // to a device (or a cloud-surface topic can be resumed on one). `owner/repo`
    // is not a path on that machine, and the initial metadata sits ABOVE the
    // device default in the precedence — so the run would spawn its CLI in a
    // directory that does not exist instead of the device's own default.
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/Users/me/app',
        deviceId: 'device-1',
        initialWorkingDirectory: 'lobehub/lobehub',
        repos,
      }),
    ).toBe('/Users/me/app');
  });

  it('skips a rich initial config whose path is a repo', () => {
    expect(
      resolveDeviceWorkingDirectoryConfig({
        deviceDefaultCwd: '/Users/me/app',
        deviceId: 'device-1',
        initialWorkingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
        repos,
      }),
    ).toEqual({ path: '/Users/me/app' });
  });

  it('prefers the agent per-device pick over a skipped repo directory', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/Users/me/app',
        deviceId: 'device-1',
        initialWorkingDirectory: 'lobehub/lobehub',
        repos,
        workingDirByDevice: { 'device-1': '/Users/me/project' },
      }),
    ).toBe('/Users/me/project');
  });

  it('skips a topic-level repo identifier, so a resumed topic cannot pin a machine to it', () => {
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/Users/me/app',
        deviceId: 'device-1',
        repos,
        topicWorkingDirectory: 'lobehub/lobehub',
      }),
    ).toBe('/Users/me/app');
  });

  it('only skips a directory the run actually declares as a repo', () => {
    // Machine paths are absolute, so shape-matching would be wrong: the guard
    // has to be the run's own repo list, not "looks like owner/repo".
    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/Users/me/app',
        deviceId: 'device-1',
        initialWorkingDirectory: '/Users/me/lobehub/lobehub',
        repos,
      }),
    ).toBe('/Users/me/lobehub/lobehub');

    expect(
      resolveDeviceWorkingDirectory({
        deviceDefaultCwd: '/Users/me/app',
        deviceId: 'device-1',
        initialWorkingDirectory: 'lobehub/lobehub',
      }),
    ).toBe('lobehub/lobehub');
  });
});
