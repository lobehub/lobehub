import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildConnectAgentConfig,
  buildPlatformAgencyConfig,
  getConnectableProvider,
} from './providers';
import { scanLocal } from './useAgentScan';

const detectHeterogeneousAgentCommand = vi.hoisted(() => vi.fn());

vi.mock('@/services/electron/binary', () => ({
  binaryService: { detectHeterogeneousAgentCommand },
}));

describe('scanLocal', () => {
  beforeEach(() => {
    detectHeterogeneousAgentCommand.mockReset();
  });

  it('scans OpenClaw and Hermes alongside the local coding-agent CLIs', async () => {
    detectHeterogeneousAgentCommand.mockImplementation(async ({ agentType }) => ({
      available: true,
      version: `${agentType}-version`,
    }));

    const agents = await scanLocal();

    expect(agents.openclaw).toEqual({ available: true, version: 'openclaw-version' });
    expect(agents.hermes).toEqual({ available: true, version: 'hermes-version' });
    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'openclaw',
      command: 'openclaw',
    });
    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'hermes',
      command: 'hermes',
    });
  });
});

describe('buildPlatformAgencyConfig', () => {
  it('uses the default local target without binding a device for this computer', () => {
    expect(buildPlatformAgencyConfig('openclaw', { kind: 'local' })).toEqual({
      heterogeneousProvider: { type: 'openclaw' },
    });
  });

  it('binds a selected remote device explicitly', () => {
    expect(
      buildPlatformAgencyConfig('hermes', { deviceId: 'remote-device', kind: 'device' }),
    ).toEqual({
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'hermes' },
    });
  });
});

describe('buildConnectAgentConfig', () => {
  it('stores a customized label as the personal name without overwriting the platform profile', () => {
    const provider = getConnectableProvider('hermes')!;

    expect(
      buildConnectAgentConfig({
        overrides: { description: ' Custom description ', name: ' Research Agent ' },
        profile: { description: 'Profile description', title: 'default' },
        provider,
        target: { kind: 'local' },
      }),
    ).toMatchObject({
      description: 'Custom description',
      name: 'Research Agent',
      title: 'default',
    });
  });

  it('stamps the runtime type as the agent provider for platform agents', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('hermes')!,
        target: { kind: 'local' },
      }),
    ).toMatchObject({ provider: 'hermes' });
  });

  it('stamps the runtime type as the agent provider for CLI agents', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('claude-code')!,
        target: { deviceId: 'device-1', kind: 'device' },
      }),
    ).toMatchObject({ provider: 'claude-code' });
  });
});
