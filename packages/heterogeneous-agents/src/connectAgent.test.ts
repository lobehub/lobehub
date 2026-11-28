import { describe, expect, it } from 'vitest';

import {
  buildConnectAgentConfig,
  CONNECTABLE_AGENT_DESCRIPTORS,
  connectedAgentDefaultName,
  DROID_AVATAR_URL,
  getConnectableAgentDescriptor,
} from './connectAgent';

const device = { deviceId: 'dev-1', kind: 'device' } as const;

describe('CONNECTABLE_AGENT_DESCRIPTORS', () => {
  it('lists every kind with a stable shape', () => {
    expect(getConnectableAgentDescriptor('antigravity')).toMatchObject({
      avatar: expect.stringContaining('/avatars/antigravity.webp'),
      command: 'agy',
      kind: 'cli',
      title: 'Antigravity',
    });
    expect(getConnectableAgentDescriptor('deepseek-harness')?.kind).toBe('runtime');
    expect(getConnectableAgentDescriptor('openclaw')).toEqual({
      kind: 'platform',
      title: expect.any(String),
      type: 'openclaw',
    });
    expect(getConnectableAgentDescriptor('droid')?.avatar).toBe(DROID_AVATAR_URL);
  });

  it('has one row per type', () => {
    const types = CONNECTABLE_AGENT_DESCRIPTORS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('buildConnectAgentConfig', () => {
  it('binds a cli agent to a device with its spawn command', () => {
    expect(
      buildConnectAgentConfig({
        overrides: { description: '  Mine  ', name: ' Agy ' },
        provider: getConnectableAgentDescriptor('antigravity')!,
        target: device,
      }),
    ).toMatchObject({
      agencyConfig: {
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { command: 'agy', type: 'antigravity' },
      },
      description: 'Mine',
      name: 'Agy',
      provider: 'antigravity',
      systemRole: '',
      title: 'Antigravity',
    });
  });

  it('leaves a runtime agent command to launch resolution', () => {
    const config = buildConnectAgentConfig({
      provider: getConnectableAgentDescriptor('deepseek-harness')!,
      target: { kind: 'local' },
    });

    expect(config.agencyConfig).toEqual({
      heterogeneousProvider: { command: undefined, type: 'deepseek-harness' },
    });
  });

  it('prefills a platform agent from its device profile', () => {
    expect(
      buildConnectAgentConfig({
        profile: { avatar: 'a.png', description: 'Claw', title: 'Clawd' },
        provider: getConnectableAgentDescriptor('openclaw')!,
        target: device,
      }),
    ).toEqual({
      agencyConfig: {
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'openclaw' },
      },
      avatar: 'a.png',
      description: 'Claw',
      name: undefined,
      provider: 'openclaw',
      title: 'Clawd',
    });
  });
});

describe('connectedAgentDefaultName', () => {
  it('uses the product title outside a shared workspace agent', () => {
    expect(connectedAgentDefaultName({ ownerName: 'Arvin', productTitle: 'Codex' })).toBe('Codex');
    expect(
      connectedAgentDefaultName({
        ownerName: 'Arvin',
        productTitle: 'Codex',
        visibility: 'private',
        workspaceId: 'ws',
      }),
    ).toBe('Codex');
  });

  it('prefixes a shared workspace agent with its owner', () => {
    expect(
      connectedAgentDefaultName({
        ownerName: ' Arvin ',
        productTitle: 'Codex',
        visibility: 'public',
        workspaceId: 'ws',
      }),
    ).toBe('Arvin’s Codex');
    expect(
      connectedAgentDefaultName({ productTitle: 'Codex', visibility: 'public', workspaceId: 'ws' }),
    ).toBe('Codex');
  });

  it('returns undefined without a product title', () => {
    expect(connectedAgentDefaultName({ productTitle: '  ' })).toBeUndefined();
  });
});
