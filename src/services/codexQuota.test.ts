import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentQuotaStore } from '@/store/agentQuota';
import { initialState } from '@/store/agentQuota/initialState';

import { agentQuotaService } from './agentQuota';
import { createCodexQuotaReader } from './codexQuota';
import { heterogeneousAgentService } from './electron/heterogeneousAgent';

vi.mock('./agentQuota', () => ({
  agentQuotaService: {
    listAccounts: vi.fn(),
    listBindings: vi.fn(),
    getLatestReadings: vi.fn(),
    ingestCodexSnapshot: vi.fn(),
    refreshCodexQuota: vi.fn(),
  },
}));
vi.mock('./electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: { getCodexQuota: vi.fn() },
}));

const account = {
  id: 'account-a',
  provider: 'codex',
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
  credits: { balance: '1250.75', unlimited: false },
  error: null,
  identity: { externalAccountId: 'external-a' },
  readings: [reading],
  provider: 'codex' as const,
  session: { usedPercent: 23, windowMinutes: 300, resetsAt: reading.resetsAt },
  status: 'ok' as const,
  updatedAt: reading.capturedAt,
  weekly: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  // Reads go through the global quota replica: start every case without the
  // previous case's accounts / readings (they would answer inside the dedupe window).
  useAgentQuotaStore.setState(initialState, false);
  vi.mocked(agentQuotaService.listAccounts).mockResolvedValue([account] as never);
  vi.mocked(agentQuotaService.listBindings).mockResolvedValue([]);
  vi.mocked(agentQuotaService.getLatestReadings).mockResolvedValue([reading]);
  vi.mocked(agentQuotaService.ingestCodexSnapshot).mockResolvedValue(account as never);
  vi.mocked(heterogeneousAgentService.getCodexQuota).mockResolvedValue(sample);
  vi.mocked(agentQuotaService.refreshCodexQuota).mockResolvedValue(sample);
});

describe('account-scoped Codex quota', () => {
  it('reads credits on first load even when persisted windows are fresh', async () => {
    const reader = createCodexQuotaReader({});
    expect((await reader()).credits).toEqual(sample.credits);
    expect((await reader()).credits).toEqual(sample.credits);
    expect(heterogeneousAgentService.getCodexQuota).toHaveBeenCalledTimes(1);
  });

  it('publishes a fresh local sample to the unified account layer', async () => {
    vi.mocked(agentQuotaService.listAccounts).mockResolvedValue([]);
    const result = await createCodexQuotaReader({})({});
    expect(result.identity?.externalAccountId).toBe('external-a');
    expect(agentQuotaService.ingestCodexSnapshot).toHaveBeenCalledWith({
      identity: sample.identity,
      readings: [reading],
    });
  });

  it('keeps local quota usable when the persistence backend is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(agentQuotaService.listAccounts).mockRejectedValue(new Error('offline'));
      vi.mocked(agentQuotaService.ingestCodexSnapshot).mockRejectedValue(new Error('offline'));
      const result = await createCodexQuotaReader({})();
      expect(result.session?.usedPercent).toBe(23);
      expect(result.status).toBe('ok');
    } finally {
      log.mockRestore();
    }
  });

  it('does not re-ingest a cached sample on focus', async () => {
    await createCodexQuotaReader({})({ revalidate: true });
    expect(agentQuotaService.ingestCodexSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes remote quota through agentQuota and keeps persisted data while offline', async () => {
    const reader = createCodexQuotaReader({ deviceId: 'device-a' });
    expect(await reader()).toMatchObject({
      credits: sample.credits,
      session: { usedPercent: 23 },
    });
    expect(agentQuotaService.refreshCodexQuota).toHaveBeenCalled();
    expect(agentQuotaService.ingestCodexSnapshot).not.toHaveBeenCalled();
    vi.mocked(agentQuotaService.refreshCodexQuota).mockResolvedValue(null);
    expect(await reader({ revalidate: true })).toMatchObject({
      credits: sample.credits,
      session: { usedPercent: 23 },
    });
    expect(heterogeneousAgentService.getCodexQuota).not.toHaveBeenCalled();
  });

  it('does not show another device account while discovering a new source', async () => {
    vi.mocked(agentQuotaService.refreshCodexQuota).mockResolvedValue(null);
    const result = await createCodexQuotaReader({ deviceId: 'device-b' })();
    expect(result.session).toBeNull();
    expect(result.status).toBe('error');
  });

  it('returns stale saved windows and credits when the confirmed account refresh fails', async () => {
    const reader = createCodexQuotaReader({ deviceId: 'device-a' });
    await reader();
    vi.mocked(agentQuotaService.refreshCodexQuota).mockResolvedValue({
      error: 'Codex RPC timed out',
      identity: sample.identity,
      provider: 'codex',
      session: null,
      status: 'error',
      updatedAt: sample.updatedAt + 1,
      weekly: null,
    });

    expect(await reader({ force: true })).toMatchObject({
      credits: sample.credits,
      error: 'Codex RPC timed out',
      identity: sample.identity,
      session: { usedPercent: 23 },
      status: 'error',
    });
  });

  it.each([null, { externalAccountId: 'external-b' }])(
    'does not reuse cached credits after an error for a different or unidentified account (%j)',
    async (identity) => {
      const reader = createCodexQuotaReader({ deviceId: 'device-a' });
      await reader();
      vi.mocked(agentQuotaService.refreshCodexQuota).mockResolvedValue({
        error: 'Codex RPC timed out',
        identity,
        provider: 'codex',
        session: null,
        status: 'error',
        updatedAt: sample.updatedAt + 1,
        weekly: null,
      });

      expect((await reader({ force: true })).credits).toBeUndefined();
      expect((await reader()).session).toBeNull();
    },
  );

  it('does not merge the previous account after the device changes login', async () => {
    const reader = createCodexQuotaReader({ deviceId: 'device-a' });
    await reader();
    vi.mocked(agentQuotaService.refreshCodexQuota).mockResolvedValue({
      ...sample,
      credits: undefined,
      identity: { externalAccountId: 'external-b' },
      readings: [],
      session: { ...sample.session, usedPercent: 80 },
    });
    const result = await reader({ revalidate: true });
    expect(result.identity?.externalAccountId).toBe('external-b');
    expect(result.session?.usedPercent).toBe(80);
    expect(result.credits).toBeUndefined();
  });

  it('refreshes the quota replica after accepting a local snapshot', async () => {
    const first = createCodexQuotaReader({});
    expect((await first({})).session?.usedPercent).toBe(23);

    // A reset lands locally and is ingested; the server now holds the new reading.
    const resetReading = { ...reading, capturedAt: Date.now() + 1, utilization: 0 };
    vi.mocked(agentQuotaService.getLatestReadings).mockResolvedValue([resetReading]);
    await first.acceptLocalSnapshot({
      ...sample,
      readings: [resetReading],
      session: { ...sample.session, usedPercent: 0 },
    });

    // A reader mounted right after (inside the dedupe window) must not repaint the old reading.
    expect((await createCodexQuotaReader({})({})).session?.usedPercent).toBe(0);
  });
});
