import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveQuotaAccountSpawnPlan } from './resolveQuotaAccountEnv';

const selectAccountForAgent = vi.hoisted(() => vi.fn());

vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: { selectAccountForAgent },
}));

const selection = (over: Record<string, unknown> = {}) => ({
  accountId: 'acc-1',
  credentialMode: 'referenced',
  credentialRef: { origin: 'keychain' },
  externalAccountId: 'ext-1',
  reason: 'pinned',
  ...over,
});

beforeEach(() => {
  selectAccountForAgent.mockReset();
});

describe('resolveQuotaAccountSpawnPlan', () => {
  it('routes a config-dir account via CLAUDE_CONFIG_DIR', async () => {
    selectAccountForAgent.mockResolvedValue(
      selection({ credentialRef: { configDir: '/profiles/work', origin: 'config-dir' } }),
    );

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(plan.env).toEqual({ CLAUDE_CONFIG_DIR: '/profiles/work' });
    expect(plan.accountId).toBe('acc-1');
    expect(plan.externalAccountId).toBe('ext-1');
    expect(plan.reason).toBe('pinned');
  });

  it('keeps the default login (no override) for a keychain account', async () => {
    selectAccountForAgent.mockResolvedValue(selection());

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(plan.env).toEqual({});
    expect(plan.externalAccountId).toBe('ext-1');
  });

  it('attributes but never injects env for a managed account', async () => {
    selectAccountForAgent.mockResolvedValue(
      selection({
        credentialMode: 'managed',
        credentialRef: { configDir: '/x', origin: 'config-dir' },
      }),
    );

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(plan.env).toEqual({});
    expect(plan.accountId).toBe('acc-1');
  });

  it.each([
    ['non-claude adapter', () => resolveQuotaAccountSpawnPlan('agt-1', 'codex')],
    ['missing agentId', () => resolveQuotaAccountSpawnPlan(undefined, 'claude-code')],
  ])('skips routing entirely for %s', async (_label, run) => {
    const plan = await run();
    expect(plan).toEqual({ env: {} });
    expect(selectAccountForAgent).not.toHaveBeenCalled();
  });

  it('degrades to no routing when the agent is unbound or the service fails', async () => {
    selectAccountForAgent.mockResolvedValueOnce(null);
    expect(await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).toEqual({ env: {} });

    selectAccountForAgent.mockRejectedValueOnce(new Error('offline'));
    expect(await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).toEqual({ env: {} });
  });
});
