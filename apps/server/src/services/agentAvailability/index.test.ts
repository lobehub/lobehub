import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAvailabilityService } from './index';

const mocks = vi.hoisted(() => ({
  accountBindings: {} as Record<string, { accountId: string; enabled: boolean; role: string }[]>,
  deviceBindings: {} as Record<string, string>,
  deviceByAgent: {} as Record<string, string>,
  loads: {} as Record<string, { enabled: boolean; rateLimitedUntil?: number | null }>,
  online: [] as { deviceId: string; online: boolean }[],
  visible: [] as string[],
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    queryAgencyRoutingByIds = async (ids: string[]) =>
      ids.filter((id) => mocks.visible.includes(id)).map((id) => ({ id }));
  },
}));
vi.mock('@/database/models/agentQuota', () => ({
  AgentAccountBindingModel: class {
    listByAgent = async (agentId: string) => mocks.accountBindings[agentId] ?? [];
  },
  AgentDeviceAccountBindingModel: class {
    find = async (agentId: string) =>
      mocks.deviceBindings[agentId] ? { accountId: mocks.deviceBindings[agentId] } : undefined;
  },
}));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agentQuota/resolveDeviceRowId', () => ({
  resolveDeviceRowId: async (_model: unknown, _ws: unknown, deviceId: string) => `row-${deviceId}`,
}));
vi.mock('@/server/routers/lambda/deviceBoundAgents', () => ({
  loadAgentDeviceBindings: async ({ agentIds }: { agentIds: string[] }) =>
    Object.fromEntries(
      agentIds.flatMap((id) => (mocks.deviceByAgent[id] ? [[id, mocks.deviceByAgent[id]]] : [])),
    ),
}));
vi.mock('@/server/services/agentQuota', () => ({
  AgentQuotaService: class {
    resolveAccountLoads = async (ids: string[]) =>
      ids.flatMap((accountId) =>
        mocks.loads[accountId] ? [{ accountId, ...mocks.loads[accountId] }] : [],
      );
  },
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: async () => mocks.online,
}));
vi.mock('@/business/server/managedDevice', () => ({
  managedDeviceProvider: { isAvailable: async () => false, listStates: async () => ({}) },
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    agentAvailability: {
      readAccounts: async (ids: string[]) => ids.map(() => undefined),
      readDevices: async (_pool: string, ids: string[]) => ids.map(() => undefined),
      rememberAccounts: async () => {},
      rememberDevices: async () => {},
    },
  },
}));

const jobCounts: { agentId: string; value: number }[] = [];
const db = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({ where: () => ({ groupBy: async () => jobCounts }) }),
    }),
  }),
} as never;

const now = 1_000_000;
const service = () => new AgentAvailabilityService(db, 'user-1');

beforeEach(() => {
  mocks.accountBindings = {};
  mocks.deviceBindings = {};
  mocks.deviceByAgent = {};
  mocks.loads = {};
  mocks.online = [];
  mocks.visible = [];
  jobCounts.length = 0;
});

describe('AgentAvailabilityService', () => {
  it('answers only for agents the caller can see', async () => {
    mocks.visible = ['mine'];
    jobCounts.push({ agentId: 'mine', value: 1 });

    const result = await service().getAvailability(['mine', 'someone-elses'], now);

    expect(Object.keys(result)).toEqual(['mine']);
    expect(result.mine).toMatchObject({ activeJobs: 1, dispatchable: true, status: 'working' });
  });

  it('ignores a device pin whose account left the agent rotation', async () => {
    mocks.visible = ['a1'];
    mocks.deviceByAgent = { a1: 'd1' };
    mocks.online = [{ deviceId: 'd1', online: true }];
    mocks.deviceBindings = { a1: 'benched' };
    mocks.accountBindings = { a1: [{ accountId: 'fresh', enabled: true, role: 'pool' }] };
    mocks.loads = {
      benched: { enabled: true, rateLimitedUntil: now + 60_000 },
      fresh: { enabled: true },
    };

    const result = await service().getAvailability(['a1'], now);

    expect(result.a1).toMatchObject({ dispatchable: true, status: 'idle' });
  });

  it('judges a device-pinned agent by its pinned account alone', async () => {
    mocks.visible = ['a1'];
    mocks.deviceByAgent = { a1: 'd1' };
    mocks.online = [{ deviceId: 'd1', online: true }];
    mocks.deviceBindings = { a1: 'benched' };
    mocks.accountBindings = {
      a1: [
        { accountId: 'benched', enabled: true, role: 'pinned' },
        { accountId: 'fresh', enabled: true, role: 'pool' },
      ],
    };
    mocks.loads = {
      benched: { enabled: true, rateLimitedUntil: now + 60_000 },
      fresh: { enabled: true },
    };

    const result = await service().getAvailability(['a1'], now);

    expect(result.a1).toMatchObject({
      dispatchable: false,
      resetsAt: now + 60_000,
      status: 'offDuty',
    });
  });

  it('reads an agent whose device is not connected as offline and not dispatchable', async () => {
    mocks.visible = ['a1'];
    mocks.deviceByAgent = { a1: 'd1' };

    const result = await service().getAvailability(['a1'], now);

    expect(result.a1).toMatchObject({ dispatchable: false, status: 'offline' });
  });
});
