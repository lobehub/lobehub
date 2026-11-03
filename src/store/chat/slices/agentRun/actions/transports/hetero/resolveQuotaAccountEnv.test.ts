import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveQuotaAccountSpawnPlan } from './resolveQuotaAccountEnv';

const selectAccountForAgent = vi.hoisted(() => vi.fn());
const listAccounts = vi.hoisted(() => vi.fn());
const listClaudeCodeAccounts = vi.hoisted(() => vi.fn());
const resolveClaudeCodeAccount = vi.hoisted(() => vi.fn());
const getClaudeCodeInheritedRoutingEnv = vi.hoisted(() => vi.fn());
const resolveGatewayDeviceId = vi.hoisted(() => vi.fn());

vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: { listAccounts, selectAccountForAgent },
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ resolveGatewayDeviceId }),
}));

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    getClaudeCodeInheritedRoutingEnv,
    listClaudeCodeAccounts,
    resolveClaudeCodeAccount,
  },
}));

const selection = (over: Record<string, unknown> = {}) => ({
  accountId: 'acc-1',
  credentialMode: 'referenced',
  credentialRef: { origin: 'keychain' },
  externalAccountId: 'ext-1',
  reason: 'pinned',
  ...over,
});

const localAccount = (externalAccountId: string, configDir: string | null) => ({
  configDir,
  identity: { externalAccountId },
});

beforeEach(() => {
  selectAccountForAgent.mockReset();
  listAccounts.mockReset().mockResolvedValue([]);
  listClaudeCodeAccounts
    .mockReset()
    .mockResolvedValue([localAccount('ext-default', null), localAccount('ext-1', '/profiles/one')]);
  resolveClaudeCodeAccount.mockReset();
  getClaudeCodeInheritedRoutingEnv.mockReset().mockResolvedValue({});
  resolveGatewayDeviceId.mockReset().mockResolvedValue(undefined);
});

describe('resolveQuotaAccountSpawnPlan', () => {
  it('runs a switched-to account on its own local profile', async () => {
    selectAccountForAgent.mockResolvedValue(selection());
    resolveClaudeCodeAccount.mockResolvedValue({ configDir: '/profiles/one', kind: 'profile' });

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(resolveClaudeCodeAccount).toHaveBeenCalledWith('ext-1');
    expect(plan.env).toEqual({ CLAUDE_CONFIG_DIR: '/profiles/one' });
    expect(plan).toMatchObject({
      accountId: 'acc-1',
      externalAccountId: 'ext-1',
      reason: 'pinned',
    });
  });

  it('keeps the default login (no override) when the account is the default login', async () => {
    selectAccountForAgent.mockResolvedValue(selection({ externalAccountId: 'ext-default' }));
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'default' });

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(plan.env).toEqual({});
    expect(plan.externalAccountId).toBe('ext-default');
  });

  it('fails a pinned account that is not signed in here instead of running another one', async () => {
    selectAccountForAgent.mockResolvedValue(selection({ externalAccountId: 'ext-elsewhere' }));
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });
    listAccounts.mockResolvedValue([{ email: 'max@x.com', id: 'acc-1', label: null }]);

    // Names the account so the run error says which login is missing.
    await expect(resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).rejects.toThrow('max@x.com');
  });

  it('asks for the account chosen on this device', async () => {
    resolveGatewayDeviceId.mockResolvedValue('device-b');
    selectAccountForAgent.mockResolvedValue(selection({ pinScope: 'device' }));
    resolveClaudeCodeAccount.mockResolvedValue({ configDir: '/profiles/one', kind: 'profile' });

    await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(selectAccountForAgent).toHaveBeenCalledWith('agt-1', {
      deviceId: 'device-b',
      provider: 'claude-code',
    });
  });

  it("fails this device's own pick when its login is gone instead of running another", async () => {
    resolveGatewayDeviceId.mockResolvedValue('device-b');
    selectAccountForAgent.mockResolvedValue(
      selection({ externalAccountId: 'ext-elsewhere', pinScope: 'device' }),
    );
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });
    listAccounts.mockResolvedValue([{ email: 'max@x.com', id: 'acc-1', label: null }]);

    await expect(resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).rejects.toThrow('max@x.com');
    expect(listClaudeCodeAccounts).not.toHaveBeenCalled();
  });

  // Regression: an account pinned on device A made every run of the agent on
  // device B fail with "not signed in on this device".
  it('re-balances an agent-wide pin made on another device onto the logins here', async () => {
    resolveGatewayDeviceId.mockResolvedValue('device-b');
    selectAccountForAgent
      .mockResolvedValueOnce(selection({ externalAccountId: 'ext-a', pinScope: 'agent' }))
      .mockResolvedValueOnce(
        selection({ accountId: 'acc-2', externalAccountId: 'ext-1', reason: 'balanced' }),
      );
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(selectAccountForAgent).toHaveBeenLastCalledWith('agt-1', {
      deviceId: 'device-b',
      provider: 'claude-code',
      runnableExternalAccountIds: ['ext-default', 'ext-1'],
    });
    expect(plan).toMatchObject({ accountId: 'acc-2', env: { CLAUDE_CONFIG_DIR: '/profiles/one' } });
  });

  it('runs on the default login when a pin from another device leaves nothing runnable here', async () => {
    selectAccountForAgent
      .mockResolvedValueOnce(selection({ externalAccountId: 'ext-a', pinScope: 'agent' }))
      .mockResolvedValueOnce(null);
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });

    await expect(resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).resolves.toEqual({
      env: {},
    });
  });

  it('re-balances Auto mode onto the accounts signed in here', async () => {
    selectAccountForAgent
      .mockResolvedValueOnce(selection({ externalAccountId: 'ext-away', reason: 'balanced' }))
      .mockResolvedValueOnce(selection({ accountId: 'acc-2', reason: 'balanced' }));
    resolveClaudeCodeAccount.mockImplementation(async (id: string) =>
      id === 'ext-1' ? { configDir: '/profiles/one', kind: 'profile' } : { kind: 'missing' },
    );

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(selectAccountForAgent).toHaveBeenLastCalledWith('agt-1', {
      provider: 'claude-code',
      runnableExternalAccountIds: ['ext-default', 'ext-1'],
    });
    expect(plan).toMatchObject({ accountId: 'acc-2', env: { CLAUDE_CONFIG_DIR: '/profiles/one' } });
    // The re-pick is mapped from the listing, not from another scan of the logins.
    expect(resolveClaudeCodeAccount).toHaveBeenCalledTimes(1);
    expect(listClaudeCodeAccounts).toHaveBeenCalledTimes(1);
  });

  it('fails Auto mode when no account in the rotation is signed in here', async () => {
    selectAccountForAgent
      .mockResolvedValueOnce(selection({ externalAccountId: 'ext-away', reason: 'balanced' }))
      .mockResolvedValueOnce(null);
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });

    // Never falls back to the default login, which is not in the rotation.
    await expect(resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).rejects.toThrow(/rotation/);
  });

  it('fails Auto mode when the desktop cannot list its logins for a re-pick', async () => {
    selectAccountForAgent.mockResolvedValue(
      selection({ externalAccountId: 'ext-away', reason: 'balanced' }),
    );
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });
    listClaudeCodeAccounts.mockRejectedValue(new Error('no ipc'));

    // The selected login is absent, so the default login must not run in its place.
    await expect(resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).rejects.toThrow(
      /Couldn't look up/,
    );
  });

  it.each([
    ['its own profile', { CLAUDE_CONFIG_DIR: '/agent/own-profile' }],
    ['an API key', { ANTHROPIC_API_KEY: 'sk-ant-xxx' }],
    ['Bedrock', { CLAUDE_CODE_USE_BEDROCK: '1' }],
    ['Vertex', { CLAUDE_CODE_USE_VERTEX: 'true' }],
  ])('lets an agent env that picks %s win over a stale pin', async (_label, agentEnv) => {
    selectAccountForAgent.mockResolvedValue(selection({ externalAccountId: 'ext-elsewhere' }));
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });

    expect(await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code', agentEnv)).toEqual({
      env: {},
    });
    expect(selectAccountForAgent).not.toHaveBeenCalled();
  });

  it('never lists local logins for an agent with no account bindings', async () => {
    selectAccountForAgent.mockResolvedValue(null);

    expect(await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).toEqual({ env: {} });
    expect(listClaudeCodeAccounts).not.toHaveBeenCalled();
    expect(resolveClaudeCodeAccount).not.toHaveBeenCalled();
    expect(getClaudeCodeInheritedRoutingEnv).not.toHaveBeenCalled();
  });

  it.each(['pinned', 'balanced'])(
    'fails a %s run whose local login lookup fails, never starting on the default login',
    async (reason) => {
      selectAccountForAgent.mockResolvedValue(selection({ reason }));
      resolveClaudeCodeAccount.mockRejectedValue(new Error('EACCES'));

      await expect(resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).rejects.toThrow(
        /Couldn't look up/,
      );
    },
  );

  it.each([
    ['Bedrock', { CLAUDE_CODE_USE_BEDROCK: '1' }],
    ['Vertex', { CLAUDE_CODE_USE_VERTEX: 'true' }],
  ])(
    'lets a %s flag inherited from the desktop win over a stale pin',
    async (_label, inherited) => {
      selectAccountForAgent.mockResolvedValue(selection({ externalAccountId: 'ext-elsewhere' }));
      resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });
      getClaudeCodeInheritedRoutingEnv.mockResolvedValue(inherited);

      // No subscription login runs, so neither the pin nor its attribution applies.
      expect(await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code')).toEqual({ env: {} });
      expect(resolveClaudeCodeAccount).not.toHaveBeenCalled();
    },
  );

  it('keeps routing when the agent env switches an inherited flag off', async () => {
    selectAccountForAgent.mockResolvedValue(selection());
    resolveClaudeCodeAccount.mockResolvedValue({ configDir: '/profiles/one', kind: 'profile' });
    getClaudeCodeInheritedRoutingEnv.mockResolvedValue({ CLAUDE_CODE_USE_BEDROCK: '1' });

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code', {
      CLAUDE_CODE_USE_BEDROCK: '0',
    });

    expect(plan).toMatchObject({ accountId: 'acc-1', env: { CLAUDE_CONFIG_DIR: '/profiles/one' } });
  });

  it('keeps routing when the desktop cannot report its inherited flags', async () => {
    selectAccountForAgent.mockResolvedValue(selection());
    resolveClaudeCodeAccount.mockResolvedValue({ configDir: '/profiles/one', kind: 'profile' });
    getClaudeCodeInheritedRoutingEnv.mockRejectedValue(new Error('no such ipc'));

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(plan.env).toEqual({ CLAUDE_CONFIG_DIR: '/profiles/one' });
  });

  it('keeps routing when an external-provider flag is set to off', async () => {
    selectAccountForAgent.mockResolvedValue(selection({ externalAccountId: 'ext-elsewhere' }));
    resolveClaudeCodeAccount.mockResolvedValue({ kind: 'missing' });

    // `0` / `false` leave the subscription login in charge, so the stale pin still counts.
    await expect(
      resolveQuotaAccountSpawnPlan('agt-1', 'claude-code', { CLAUDE_CODE_USE_BEDROCK: '0' }),
    ).rejects.toThrow(/isn't signed in on this device/);
  });

  it('attributes but never injects env for a managed account', async () => {
    selectAccountForAgent.mockResolvedValue(selection({ credentialMode: 'managed' }));

    const plan = await resolveQuotaAccountSpawnPlan('agt-1', 'claude-code');

    expect(plan.env).toEqual({});
    expect(plan.accountId).toBe('acc-1');
    expect(resolveClaudeCodeAccount).not.toHaveBeenCalled();
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
