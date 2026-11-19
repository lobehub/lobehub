import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAvailabilityService } from './index';

const mocks = vi.hoisted(() => ({
  deviceByAgent: {} as Record<string, string>,
  online: [] as { deviceId: string; online: boolean }[],
  quota: {} as Record<string, { resetsAt?: number; status: string }>,
  quotaCalls: [] as { agentId: string; deviceId?: string; provider?: string }[],
  /** Agents that run Claude Code through bound accounts. */
  routed: [] as string[],
  visible: [] as string[],
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    queryAgencyRoutingByIds = async (ids: string[]) =>
      ids
        .filter((id) => mocks.visible.includes(id))
        .map((id) => ({
          agencyConfig: mocks.routed.includes(id)
            ? { heterogeneousProvider: { type: 'claude-code' } }
            : id === 'own-login'
              ? { heterogeneousProvider: { env: { ANTHROPIC_API_KEY: 'sk' }, type: 'claude-code' } }
              : null,
          id,
        }));
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
    resolveAgentAvailability = async (
      agentId: string,
      options: { deviceId?: string; provider?: string },
    ) => {
      mocks.quotaCalls.push({ agentId, deviceId: options.deviceId, provider: options.provider });
      return mocks.quota[agentId] ?? { accountIds: [], status: 'untracked' };
    };
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
      readDevices: async (_pool: string, ids: string[]) => ids.map(() => undefined),
      readQuotas: async (_user: string, _pool: string, keys: unknown[]) =>
        keys.map(() => undefined),
      rememberDevices: async () => {},
      rememberQuotas: async () => {},
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
  mocks.deviceByAgent = {};
  mocks.online = [];
  mocks.quota = {};
  mocks.quotaCalls = [];
  mocks.routed = [];
  mocks.visible = [];
  jobCounts.length = 0;
});

describe('AgentAvailabilityService', () => {
  it('answers only for agents the caller can see', async () => {
    mocks.visible = ['mine'];
    mocks.routed = ['mine', 'someone-elses'];
    mocks.deviceByAgent = { 'mine': 'd1', 'someone-elses': 'd2' };
    mocks.online = [{ deviceId: 'd1', online: true }];
    jobCounts.push({ agentId: 'mine', value: 1 });

    const result = await service().getAvailability(['mine', 'someone-elses'], now);

    expect(Object.keys(result)).toEqual(['mine']);
    expect(result.mine).toMatchObject({ activeJobs: 1, dispatchable: true, status: 'working' });
    expect(mocks.quotaCalls.map((call) => call.agentId)).toEqual(['mine']);
  });

  it('judges quota on the device row the agent runs on', async () => {
    mocks.visible = ['a1'];
    mocks.routed = ['a1'];
    mocks.deviceByAgent = { a1: 'd1' };
    mocks.online = [{ deviceId: 'd1', online: true }];
    mocks.quota = { a1: { resetsAt: now + 60_000, status: 'exhausted' } };

    const result = await service().getAvailability(['a1'], now);

    expect(mocks.quotaCalls).toEqual([
      { agentId: 'a1', deviceId: 'row-d1', provider: 'claude-code' },
    ]);
    expect(result.a1).toMatchObject({
      dispatchable: false,
      resetsAt: now + 60_000,
      status: 'offDuty',
    });
  });

  it('never judges an agent whose runs skip bound accounts', async () => {
    mocks.visible = ['own-login', 'native'];
    mocks.quota = {
      'native': { status: 'exhausted' },
      'own-login': { status: 'exhausted' },
    };

    const result = await service().getAvailability(['own-login', 'native'], now);

    expect(mocks.quotaCalls).toEqual([]);
    expect(result['own-login']).toMatchObject({ dispatchable: true, status: 'online' });
    expect(result.native).toMatchObject({ dispatchable: true, status: 'online' });
  });

  it('never judges a Claude Code agent that runs in the Cloud Sandbox', async () => {
    mocks.visible = ['sandbox'];
    mocks.routed = ['sandbox'];
    mocks.quota = { sandbox: { status: 'exhausted' } };

    const result = await service().getAvailability(['sandbox'], now);

    expect(mocks.quotaCalls).toEqual([]);
    expect(result.sandbox).toMatchObject({ dispatchable: true, status: 'online' });
  });

  it('keeps an agent with untracked quota on duty', async () => {
    mocks.visible = ['a1'];
    mocks.routed = ['a1'];

    const result = await service().getAvailability(['a1'], now);

    expect(result.a1).toMatchObject({ dispatchable: true, status: 'online' });
  });

  it('reads an agent whose device is not connected as offline and not dispatchable', async () => {
    mocks.visible = ['a1'];
    mocks.deviceByAgent = { a1: 'd1' };

    const result = await service().getAvailability(['a1'], now);

    expect(result.a1).toMatchObject({ dispatchable: false, status: 'offline' });
  });
});
