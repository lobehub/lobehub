import { describe, expect, it } from 'vitest';

import { isCodexPermissionConfigurable } from './codexPermission';

describe('isCodexPermissionConfigurable', () => {
  it('allows Agent-level permission changes for local execution', () => {
    expect(
      isCodexPermissionConfigurable({
        agentId: 'agent-1',
        canConfigure: true,
        saving: false,
      }),
    ).toBe(true);
  });

  it.each([
    ['missing edit access', { agentId: 'agent-1', canConfigure: false }],
    ['a missing Agent', { agentId: '', canConfigure: true }],
  ])('blocks permission changes for %s', (_case, options) => {
    expect(isCodexPermissionConfigurable({ ...options, saving: false })).toBe(false);
  });

  it('blocks duplicate changes while saving', () => {
    expect(
      isCodexPermissionConfigurable({
        agentId: 'agent-1',
        canConfigure: true,
        saving: true,
      }),
    ).toBe(false);
  });
});
