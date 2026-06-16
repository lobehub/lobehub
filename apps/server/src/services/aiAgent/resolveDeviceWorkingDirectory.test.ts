import { describe, expect, it } from 'vitest';

import { resolveDeviceWorkingDirectory } from './resolveDeviceWorkingDirectory';

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
          'device-1': { git: { activeWorktree: '/repo-fix' }, path: '/repo', repoType: 'git' },
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
