import { describe, expect, it } from 'vitest';

import { resolveClaudeCodeLaunchPlan } from './claudeCodeLaunchPlan';

const base = {
  apiConfig: { model: 'claude-sonnet', providerId: 'anthropic' },
  capability: { direct: true, gateway: 'anthropic-messages' as const },
  providerEnabled: true,
  providerHasApiKey: true,
};

describe('resolveClaudeCodeLaunchPlan', () => {
  it.each([
    ['local', 'direct'],
    ['device', 'gateway'],
    ['sandbox', 'gateway'],
    ['auto', 'gateway'],
  ] as const)('resolves %s to %s credentials', (target, credentialMode) => {
    const result = resolveClaudeCodeLaunchPlan({ ...base, target });

    expect(result.plan).toMatchObject({
      credentialMode,
      requiredCapability: credentialMode,
      target,
    });
    expect(result.plan?.modelRoles).toEqual({
      background: 'claude-sonnet',
      primary: 'claude-sonnet',
      smallFast: 'claude-sonnet',
      subagent: 'claude-sonnet',
    });
  });

  it('removes stale model args and uses the binding as the source of truth', () => {
    const result = resolveClaudeCodeLaunchPlan({
      ...base,
      args: ['--verbose', '--model', 'old', '--model=older'],
      target: 'device',
    });

    expect(result.plan?.args).toEqual(['--verbose']);
  });

  it('rejects remote providers without an explicit gateway capability', () => {
    const result = resolveClaudeCodeLaunchPlan({
      ...base,
      capability: { direct: true },
      target: 'sandbox',
    });

    expect(result.error).toContain('has not enabled the Claude Code Gateway');
  });

  it('rejects localhost-style providers before remote dispatch', () => {
    const result = resolveClaudeCodeLaunchPlan({
      ...base,
      providerReachableFromGateway: false,
      target: 'device',
    });

    expect(result.error).toContain('not reachable from the server gateway');
  });
});
