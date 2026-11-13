// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return {
      findByDeviceId: vi.fn(async (id: string) => (id === 'gateway-a' ? { id: 'row-a' } : null)),
      findWorkspaceDeviceById: vi.fn(),
    };
  }),
}));

vi.mock('@/database/models/agentQuota', () => ({
  AgentAccountBindingModel: vi.fn(function () {
    return {};
  }),
  AgentProviderAccountModel: vi.fn(function () {
    return {};
  }),
  AgentQuotaWindowModel: vi.fn(function () {
    return {};
  }),
}));

class QuotaAccountNotFoundError extends Error {
  accountIds: string[];
  constructor(accountIds: string[]) {
    super('Account not found');
    this.accountIds = accountIds;
  }
}

const config = {
  authorizedAccountIds: ['acc-1'],
  candidateAccountIds: ['acc-1'],
  mode: 'auto',
  pinScope: null,
  pinnedAccountId: null,
};
const service = {
  getLoadBalanceConfig: vi.fn(async () => config),
  listAgentAccounts: vi.fn(async () => [{ authorized: true, id: 'acc-1' }]),
  setAgentAccounts: vi.fn(async () => config),
};
vi.mock('@/server/services/agentQuota', () => ({
  AccountNotSignedInOnDeviceError: class extends Error {},
  AgentQuotaService: vi.fn(function () {
    return service;
  }),
  QuotaAccountNotFoundError,
}));

const { agentQuotaRouter } = await import('../agentQuota');

const caller = () =>
  agentQuotaRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: null } as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agentQuota authorized-account procedures', () => {
  it('lists the pool with authorization for one provider', async () => {
    await expect(
      caller().listAgentAccounts({ agentId: 'agt-1', provider: 'claude-code' }),
    ).resolves.toEqual([{ authorized: true, id: 'acc-1' }]);
    expect(service.listAgentAccounts).toHaveBeenCalledWith('agt-1', 'claude-code');
  });

  it('sets the authorized set and returns the load-balancing config', async () => {
    await expect(
      caller().setAgentAccounts({
        accountIds: ['acc-1'],
        agentId: 'agt-1',
        provider: 'claude-code',
      }),
    ).resolves.toEqual(config);
    expect(service.setAgentAccounts).toHaveBeenCalledWith('agt-1', ['acc-1'], 'claude-code');
  });

  it('answers NOT_FOUND for an account the caller cannot see', async () => {
    service.setAgentAccounts.mockRejectedValueOnce(new QuotaAccountNotFoundError(['acc-x']));
    await expect(
      caller().setAgentAccounts({ accountIds: ['acc-x'], agentId: 'agt-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('resolves the gateway device id before reading the load-balancing config', async () => {
    await caller().getLoadBalanceConfig({ agentId: 'agt-1', deviceId: 'gateway-a' });
    expect(service.getLoadBalanceConfig).toHaveBeenCalledWith('agt-1', {
      deviceId: 'row-a',
      provider: undefined,
    });
  });
});
