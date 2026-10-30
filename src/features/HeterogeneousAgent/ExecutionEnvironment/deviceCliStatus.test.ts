import { describe, expect, it } from 'vitest';

import { getDeviceInstallCommands, resolveDeviceCliState } from './deviceCliStatus';

const CLAUDE_INSTALL = [
  'curl -fsSL https://claude.ai/install.sh | bash',
  'brew install --cask claude-code',
];

describe('resolveDeviceCliState', () => {
  it('reports the version an online device found', () => {
    expect(
      resolveDeviceCliState({
        agentType: 'claude-code',
        presence: 'online',
        scan: { agents: { 'claude-code': { available: true, version: '2.1.0' } } },
      }),
    ).toEqual({ status: 'available', version: '2.1.0' });
  });

  it('reports the CLI missing only when the online device answered without it', () => {
    expect(
      resolveDeviceCliState({
        agentType: 'claude-code',
        presence: 'online',
        scan: { agents: { 'claude-code': { available: false } } },
      }),
    ).toEqual({ status: 'unavailable' });
  });

  it('never calls an offline device "not installed"', () => {
    expect(resolveDeviceCliState({ agentType: 'claude-code', presence: 'offline' })).toEqual({
      status: 'offline',
    });
  });

  it('waits while presence or the scan is unknown', () => {
    expect(resolveDeviceCliState({ agentType: 'claude-code', presence: 'checking' })).toEqual({
      status: 'checking',
    });
    expect(resolveDeviceCliState({ agentType: 'claude-code', presence: 'online' })).toEqual({
      status: 'checking',
    });
  });

  it('separates a failed scan from a missing CLI', () => {
    expect(
      resolveDeviceCliState({
        agentType: 'claude-code',
        presence: 'online',
        scan: { agents: {}, error: 'Device tool call failed' },
      }),
    ).toEqual({ reason: 'Device tool call failed', status: 'scanFailed' });
    expect(
      resolveDeviceCliState({
        agentType: 'claude-code',
        presence: 'online',
        scanError: new Error('timeout'),
      }),
    ).toEqual({ reason: 'timeout', status: 'scanFailed' });
  });

  it('treats a type an older device client did not probe as unknown', () => {
    expect(
      resolveDeviceCliState({
        agentType: 'kimi-code',
        presence: 'online',
        scan: { agents: { 'claude-code': { available: true } } },
      }),
    ).toEqual({ status: 'scanFailed' });
  });

  it('flags a bound device that is gone from the confirmed list', () => {
    expect(resolveDeviceCliState({ agentType: 'claude-code', presence: 'missing' })).toEqual({
      status: 'deviceMissing',
    });
  });
});

describe('getDeviceInstallCommands', () => {
  it('drops Homebrew for a Linux device', () => {
    expect(getDeviceInstallCommands(CLAUDE_INSTALL, 'linux')).toEqual([CLAUDE_INSTALL[0]]);
  });

  it('keeps Homebrew for macOS and for an unknown platform', () => {
    expect(getDeviceInstallCommands(CLAUDE_INSTALL, 'darwin')).toEqual(CLAUDE_INSTALL);
    expect(getDeviceInstallCommands(CLAUDE_INSTALL, null)).toEqual(CLAUDE_INSTALL);
  });
});
