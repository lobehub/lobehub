// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

const mockFindByDeviceId = vi.fn();
const mockIngestSnapshot = vi.fn(async () => ({ ok: true }));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(() => ({ findByDeviceId: mockFindByDeviceId })),
}));

vi.mock('@/database/models/agentQuota', () => ({
  AgentAccountBindingModel: vi.fn(() => ({})),
  AgentProviderAccountModel: vi.fn(() => ({})),
  AgentQuotaWindowModel: vi.fn(() => ({})),
}));

vi.mock('@/server/services/agentQuota', () => ({
  AgentQuotaService: vi.fn(() => ({ ingestSnapshot: mockIngestSnapshot })),
}));

const { agentQuotaRouter } = await import('../agentQuota');

const createCaller = () => agentQuotaRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

const READINGS = [
  {
    capturedAt: 1_700_000_000_000,
    limitType: 'session',
    resetsAt: null,
    scopeKey: '',
    utilization: 5,
  },
];

const ingest = (deviceId?: string) =>
  createCaller().ingestSnapshot({
    deviceId,
    identity: { externalAccountId: 'ext-1' },
    provider: 'claude-code',
    readings: READINGS,
  });

describe('agentQuota.ingestSnapshot device resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the gateway device id to the devices row uuid', async () => {
    // Clients only know the gateway id stored in `agencyConfig.boundDeviceId`;
    // snapshots reference `devices.id`. Passing the gateway id straight through
    // fails the uuid/foreign-key check and takes the whole ingest down.
    mockFindByDeviceId.mockResolvedValue({ id: '7b9a6767-9d4c-4924-86ff-135be4b2101a' });

    await ingest('agent-testing-quota-device');

    expect(mockFindByDeviceId).toHaveBeenCalledWith('agent-testing-quota-device');
    expect(mockIngestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: '7b9a6767-9d4c-4924-86ff-135be4b2101a' }),
    );
  });

  it('still persists the reading when the device cannot be resolved', async () => {
    mockFindByDeviceId.mockResolvedValue(undefined);

    await ingest('unknown-device');

    expect(mockIngestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: undefined, readings: READINGS }),
    );
  });

  it('skips the device lookup entirely for a local (deviceless) sample', async () => {
    await ingest(undefined);

    expect(mockFindByDeviceId).not.toHaveBeenCalled();
    expect(mockIngestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: undefined }),
    );
  });
});
