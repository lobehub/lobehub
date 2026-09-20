import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentQuotaService } from './agentQuota';
import { heterogeneousAgentService } from './electron/heterogeneousAgent';
import { createKimiCodeQuotaReader } from './kimiCodeQuota';

vi.mock('./agentQuota', () => ({
  agentQuotaService: {
    listAccounts: vi.fn(),
    listBindings: vi.fn(),
    getLatestReadings: vi.fn(),
    ingestKimiCodeSnapshot: vi.fn(),
    refreshKimiCodeQuota: vi.fn(),
  },
}));
vi.mock('./electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: { getKimiCodeQuota: vi.fn() },
}));

const account = {
  id: 'account-a',
  provider: 'kimi-code',
  externalAccountId: 'external-a',
  updatedAt: new Date(),
};
const reading = {
  capturedAt: Date.now(),
  limitType: 'session',
  resetsAt: Date.now() + 60000,
  scopeKey: '',
  utilization: 23,
  windowMinutes: 300,
};
const sample = {
  error: null,
  extraUsage: null,
  identity: { externalAccountId: 'external-a' },
  monthly: null,
  monthlyCode: null,
  readings: [reading],
  provider: 'kimi-code' as const,
  session: { usedPercent: 23, windowMinutes: 300, resetsAt: reading.resetsAt },
  status: 'ok' as const,
  updatedAt: reading.capturedAt,
  weekly: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(agentQuotaService.listAccounts).mockResolvedValue([account] as never);
  vi.mocked(agentQuotaService.listBindings).mockResolvedValue([]);
  vi.mocked(agentQuotaService.getLatestReadings).mockResolvedValue([reading]);
  vi.mocked(agentQuotaService.ingestKimiCodeSnapshot).mockResolvedValue(account as never);
  vi.mocked(heterogeneousAgentService.getKimiCodeQuota).mockResolvedValue(sample);
  vi.mocked(agentQuotaService.refreshKimiCodeQuota).mockResolvedValue(sample);
});

describe('account-scoped Kimi Code quota', () => {
  it('renders fresh persisted local quota without probing the CLI', async () => {
    const result = await createKimiCodeQuotaReader({})({});
    expect(result.session?.usedPercent).toBe(23);
    expect(heterogeneousAgentService.getKimiCodeQuota).not.toHaveBeenCalled();
  });

  it('publishes a fresh local sample to the unified account layer', async () => {
    vi.mocked(agentQuotaService.listAccounts).mockResolvedValue([]);
    const result = await createKimiCodeQuotaReader({})({});
    expect(result.identity?.externalAccountId).toBe('external-a');
    expect(agentQuotaService.ingestKimiCodeSnapshot).toHaveBeenCalledWith({
      extraUsage: null,
      identity: sample.identity,
      readings: [reading],
    });
  });

  it('publishes the wallet even when the windows did not move', async () => {
    const extraUsage = {
      balanceCents: 1234,
      currency: 'USD',
      monthlyChargeLimitCents: 5000,
      monthlyChargeLimitEnabled: true,
      monthlyUsedCents: 42,
      totalCents: 2000,
    };
    // Same readings as persisted (fresh === []), but a live wallet is present.
    vi.mocked(heterogeneousAgentService.getKimiCodeQuota).mockResolvedValue({
      ...sample,
      extraUsage,
    });
    await createKimiCodeQuotaReader({})({ force: true });
    expect(agentQuotaService.ingestKimiCodeSnapshot).toHaveBeenCalledWith({
      extraUsage,
      identity: sample.identity,
      readings: [],
    });
  });

  it('surfaces an unavailable login instead of stale persisted quota', async () => {
    vi.mocked(heterogeneousAgentService.getKimiCodeQuota).mockResolvedValue({
      ...sample,
      identity: undefined,
      monthly: null,
      readings: undefined,
      reason: 'credentials-expired' as const,
      session: null,
      status: 'unavailable' as const,
    });
    const result = await createKimiCodeQuotaReader({})({ force: true });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('credentials-expired');
  });

  it('keeps local quota usable when the persistence backend is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(agentQuotaService.listAccounts).mockRejectedValue(new Error('offline'));
      vi.mocked(agentQuotaService.ingestKimiCodeSnapshot).mockRejectedValue(new Error('offline'));
      const result = await createKimiCodeQuotaReader({})();
      expect(result.session?.usedPercent).toBe(23);
      expect(result.status).toBe('ok');
    } finally {
      log.mockRestore();
    }
  });

  it('does not re-ingest a cached sample on focus', async () => {
    await createKimiCodeQuotaReader({})({ revalidate: true });
    expect(agentQuotaService.ingestKimiCodeSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes remote quota through agentQuota and keeps persisted data while offline', async () => {
    const reader = createKimiCodeQuotaReader({ deviceId: 'device-a' });
    expect((await reader()).session?.usedPercent).toBe(23);
    expect(agentQuotaService.refreshKimiCodeQuota).toHaveBeenCalled();
    expect(agentQuotaService.ingestKimiCodeSnapshot).not.toHaveBeenCalled();
    vi.mocked(agentQuotaService.refreshKimiCodeQuota).mockResolvedValue(null);
    expect((await reader({ revalidate: true })).session?.usedPercent).toBe(23);
    expect(heterogeneousAgentService.getKimiCodeQuota).not.toHaveBeenCalled();
  });

  it('does not show another device account while discovering a new source', async () => {
    vi.mocked(agentQuotaService.refreshKimiCodeQuota).mockResolvedValue(null);
    const result = await createKimiCodeQuotaReader({ deviceId: 'device-b' })();
    expect(result.session).toBeNull();
    expect(result.status).toBe('error');
  });

  it('does not merge the previous account after the device changes login', async () => {
    const reader = createKimiCodeQuotaReader({ deviceId: 'device-a' });
    await reader();
    vi.mocked(agentQuotaService.refreshKimiCodeQuota).mockResolvedValue({
      ...sample,
      identity: { externalAccountId: 'external-b' },
      readings: [],
      session: { ...sample.session, usedPercent: 80 },
    });
    const result = await reader({ revalidate: true });
    expect(result.identity?.externalAccountId).toBe('external-b');
    expect(result.session?.usedPercent).toBe(80);
  });
});
