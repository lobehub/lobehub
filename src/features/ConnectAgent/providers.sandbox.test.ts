import { describe, expect, it } from 'vitest';

import { buildConnectAgentConfig, getConnectableProvider } from './providers';

const opencode = getConnectableProvider('opencode')!;

describe('buildConnectAgentConfig — sandbox target', () => {
  it('marks the agent as sandbox-executed and binds it to no device', () => {
    const config = buildConnectAgentConfig({ provider: opencode, target: { kind: 'sandbox' } });

    expect(config.agencyConfig).toEqual({
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'opencode' },
    });
    expect(config.agencyConfig).not.toHaveProperty('boundDeviceId');
  });

  it('leaves the command to the image, having inspected no machine', () => {
    const config = buildConnectAgentConfig({ provider: opencode, target: { kind: 'sandbox' } });

    expect(config.agencyConfig.heterogeneousProvider).not.toHaveProperty('command');
  });

  it('still pins a local target to this machine, command and all', () => {
    const config = buildConnectAgentConfig({ provider: opencode, target: { kind: 'local' } });

    expect(config.agencyConfig).toEqual({
      heterogeneousProvider: { command: opencode.command, type: 'opencode' },
    });
  });
});
