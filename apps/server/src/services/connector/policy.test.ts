// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertConnectorAllowed, evaluateConnectorPolicy } from './policy';

const mocks = vi.hoisted(() => ({ loadTenantSettings: vi.fn() }));

vi.mock('@lobechat/business-config/tenant-settings', () => ({
  loadTenantSettings: mocks.loadTenantSettings,
}));

const open = { allowCustomConnectors: true, allowlist: [], blocklist: [] };

describe('evaluateConnectorPolicy', () => {
  it('restricts nothing without a policy', () => {
    expect(evaluateConnectorPolicy(undefined, { identifier: 'x', sourceType: 'custom' })).toBe(
      undefined,
    );
  });

  it('rejects custom connectors when members may not add their own', () => {
    const policy = { ...open, allowCustomConnectors: false };
    expect(evaluateConnectorPolicy(policy, { identifier: 'a1b2', sourceType: 'custom' })).toBe(
      'custom_disabled',
    );
    expect(evaluateConnectorPolicy(policy, { identifier: 'docs', sourceType: 'marketplace' })).toBe(
      undefined,
    );
  });

  it('lets custom connectors through the lists, whose identifiers are generated', () => {
    const policy = { ...open, allowlist: ['docs'], blocklist: ['a1b2'] };
    expect(evaluateConnectorPolicy(policy, { identifier: 'a1b2', sourceType: 'custom' })).toBe(
      undefined,
    );
  });

  it('rejects blocklisted marketplace connectors even when allowlisted', () => {
    const policy = { ...open, allowlist: ['docs'], blocklist: ['docs'] };
    expect(evaluateConnectorPolicy(policy, { identifier: 'docs', sourceType: 'marketplace' })).toBe(
      'blocked',
    );
  });

  it('rejects marketplace connectors outside a non-empty allowlist', () => {
    const policy = { ...open, allowlist: ['docs'] };
    expect(
      evaluateConnectorPolicy(policy, { identifier: 'github', sourceType: 'marketplace' }),
    ).toBe('not_allowlisted');
    expect(evaluateConnectorPolicy(policy, { identifier: 'docs', sourceType: 'marketplace' })).toBe(
      undefined,
    );
  });

  it('never restricts built-in tools', () => {
    const policy = { allowCustomConnectors: false, allowlist: ['docs'], blocklist: ['lobe-creds'] };
    expect(
      evaluateConnectorPolicy(policy, { identifier: 'lobe-creds', sourceType: 'builtin' }),
    ).toBe(undefined);
  });
});

describe('assertConnectorAllowed', () => {
  beforeEach(() => mocks.loadTenantSettings.mockReset());

  it('reads the current tenant policy and answers FORBIDDEN with the reason', async () => {
    mocks.loadTenantSettings.mockResolvedValue({
      connectorPolicy: { ...open, blocklist: ['shady'] },
    });
    await expect(
      assertConnectorAllowed({ identifier: 'shady', sourceType: 'marketplace' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/blocked/) });
    await expect(
      assertConnectorAllowed({ identifier: 'docs', sourceType: 'marketplace' }),
    ).resolves.toBeUndefined();
  });

  it('allows everything in builds without tenant settings', async () => {
    mocks.loadTenantSettings.mockResolvedValue(undefined);
    await expect(
      assertConnectorAllowed({ identifier: 'x', sourceType: 'custom' }),
    ).resolves.toBeUndefined();
  });
});
