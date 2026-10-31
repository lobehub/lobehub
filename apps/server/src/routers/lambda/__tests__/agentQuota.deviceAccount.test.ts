// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AgentQuotaModule from '@/server/services/agentQuota';

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

const mockFindByDeviceId = vi.fn();
vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return { findByDeviceId: mockFindByDeviceId, findWorkspaceDeviceById: vi.fn() };
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

const mockGetDeviceAccount = vi.fn();
const mockSetDeviceAccount = vi.fn();
const mockSelectForAgent = vi.fn();
vi.mock('@/server/services/agentQuota', async (importOriginal) => {
  const { AccountNotSignedInOnDeviceError } = await importOriginal<typeof AgentQuotaModule>();
  return {
    AccountNotSignedInOnDeviceError,
    AgentQuotaService: vi.fn(function () {
      return {
        getDeviceAccount: mockGetDeviceAccount,
        selectForAgent: mockSelectForAgent,
        setDeviceAccount: mockSetDeviceAccount,
      };
    }),
  };
});

const { AccountNotSignedInOnDeviceError } = await import('@/server/services/agentQuota');
const { agentQuotaRouter } = await import('../agentQuota');

const caller = () => agentQuotaRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mockFindByDeviceId.mockImplementation(async (id: string) =>
    id === 'gateway-a' ? { id: 'row-a' } : undefined,
  );
});

describe('agentQuota per-device account choice', () => {
  it('reads and writes the choice on the device row, not the gateway id', async () => {
    mockGetDeviceAccount.mockResolvedValue('acc-1');

    await expect(
      caller().getDeviceAccount({ agentId: 'agt-1', deviceId: 'gateway-a' }),
    ).resolves.toEqual({ accountId: 'acc-1' });
    await caller().setDeviceAccount({ accountId: null, agentId: 'agt-1', deviceId: 'gateway-a' });

    expect(mockGetDeviceAccount).toHaveBeenCalledWith('agt-1', 'row-a');
    expect(mockSetDeviceAccount).toHaveBeenCalledWith('agt-1', 'row-a', null);
  });

  it('answers Auto for a device it cannot resolve, and refuses to write there', async () => {
    await expect(
      caller().getDeviceAccount({ agentId: 'agt-1', deviceId: 'unknown' }),
    ).resolves.toEqual({ accountId: null });
    await expect(
      caller().setDeviceAccount({ accountId: 'acc-1', agentId: 'agt-1', deviceId: 'unknown' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockSetDeviceAccount).not.toHaveBeenCalled();
  });

  it('reports a pick without a login on the device as a precondition failure', async () => {
    mockSetDeviceAccount.mockRejectedValue(new AccountNotSignedInOnDeviceError());

    await expect(
      caller().setDeviceAccount({ accountId: 'acc-1', agentId: 'agt-1', deviceId: 'gateway-a' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('selects for the run device', async () => {
    mockSelectForAgent.mockResolvedValue(null);

    await caller().selectAccountForAgent({ agentId: 'agt-1', deviceId: 'gateway-a' });

    expect(mockSelectForAgent).toHaveBeenCalledWith(
      'agt-1',
      expect.objectContaining({ deviceId: 'row-a' }),
    );
  });
});
