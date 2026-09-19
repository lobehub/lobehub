// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
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

const mockCodexQuota = vi.fn();
const mockFindAccount = vi.fn();
const mockLatestReadings = vi.fn();
const mockVisibleDevice = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { codexQuota: mockCodexQuota },
}));
vi.mock('../deviceWorkspaceGuard', () => ({ assertWorkspaceDeviceVisible: mockVisibleDevice }));
const mockFindByDeviceId = vi.fn();
const mockFindWorkspaceDeviceById = vi.fn();
const mockIngestSnapshot = vi.fn(async () => ({ ok: true }));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return {
      findByDeviceId: mockFindByDeviceId,
      findWorkspaceDeviceById: mockFindWorkspaceDeviceById,
    };
  }),
}));

vi.mock('@/database/models/agentQuota', () => ({
  AgentAccountBindingModel: vi.fn(function () {
    return {};
  }),
  AgentProviderAccountModel: vi.fn(function () {
    return { findByExternalId: mockFindAccount };
  }),
  AgentQuotaWindowModel: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/agentQuota', () => ({
  AgentQuotaService: vi.fn(function () {
    return { ingestSnapshot: mockIngestSnapshot, listLatestReadings: mockLatestReadings };
  }),
}));

const { agentQuotaRouter } = await import('../agentQuota');

const createCaller = (workspaceId?: string) =>
  agentQuotaRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId } as any);

const READINGS = [
  {
    capturedAt: 1_700_000_000_000,
    limitType: 'session',
    resetsAt: null,
    scopeKey: '',
    utilization: 5,
  },
];

const ingest = (deviceId?: string, workspaceId?: string) =>
  createCaller(workspaceId).ingestSnapshot({
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

  it('resolves a workspace device enrolled by another member', async () => {
    // A workspace device's identity is (workspaceId, deviceId); `userId` only
    // records the first enroller, so the personal lookup misses a machine any
    // other member enrolled and the snapshot would lose its attribution.
    mockFindWorkspaceDeviceById.mockResolvedValue({ id: 'ws-device-uuid' });
    mockFindByDeviceId.mockResolvedValue(undefined);

    await ingest('shared-build-server', 'ws-1');

    expect(mockFindWorkspaceDeviceById).toHaveBeenCalledWith('shared-build-server');
    expect(mockIngestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'ws-device-uuid' }),
    );
  });

  it('falls back to the personal device when a workspace request names one', async () => {
    mockFindWorkspaceDeviceById.mockResolvedValue(undefined);
    mockFindByDeviceId.mockResolvedValue({ id: 'personal-device-uuid' });

    await ingest('my-laptop', 'ws-1');

    expect(mockIngestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'personal-device-uuid' }),
    );
  });

  it('skips the workspace lookup outside a workspace context', async () => {
    mockFindByDeviceId.mockResolvedValue({ id: 'personal-device-uuid' });

    await ingest('my-laptop');

    expect(mockFindWorkspaceDeviceById).not.toHaveBeenCalled();
  });
});

describe('agentQuota.refreshCodexQuota', () => {
  const snapshot = {
    error: null,
    identity: { externalAccountId: 'codex-account' },
    provider: 'codex',
    readings: READINGS,
    status: 'ok',
    updatedAt: 1_700_000_000_000,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisibleDevice.mockResolvedValue(undefined);
    mockFindAccount.mockResolvedValue(undefined);
    mockLatestReadings.mockResolvedValue([]);
    mockFindByDeviceId.mockResolvedValue({ id: 'device-row' });
    mockFindWorkspaceDeviceById.mockResolvedValue(undefined);
    mockCodexQuota.mockResolvedValue(snapshot);
  });

  it('refreshes and persists the remote account rather than returning an isolated device sample', async () => {
    const result = await createCaller().refreshCodexQuota({ deviceId: 'remote' });
    expect(result).toEqual(snapshot);
    expect(mockIngestSnapshot).toHaveBeenCalledWith({
      deviceId: 'device-row',
      identity: snapshot.identity,
      provider: 'codex',
      readings: READINGS,
    });
  });

  it('does not append the same cached readings twice', async () => {
    mockFindAccount.mockResolvedValue({ id: 'account' });
    mockLatestReadings.mockResolvedValue(READINGS);
    await createCaller().refreshCodexQuota({ deviceId: 'remote' });
    expect(mockIngestSnapshot).not.toHaveBeenCalled();
  });

  it('does not persist an unidentified sample', async () => {
    mockCodexQuota.mockResolvedValue({ ...snapshot, identity: null });
    await createCaller().refreshCodexQuota({ deviceId: 'remote' });
    expect(mockIngestSnapshot).not.toHaveBeenCalled();
  });

  it('checks workspace device visibility before sampling', async () => {
    mockVisibleDevice.mockRejectedValue(new Error('hidden device'));
    await expect(
      createCaller('workspace').refreshCodexQuota({ deviceId: 'remote' }),
    ).rejects.toThrow('hidden device');
    expect(mockCodexQuota).not.toHaveBeenCalled();
    expect(mockIngestSnapshot).not.toHaveBeenCalled();
  });
});
