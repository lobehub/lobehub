import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAccountView, registerQuotaCommand } from './quota';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentQuota: {
      getLatestReadings: { query: vi.fn() },
      listAccounts: { query: vi.fn() },
      listActiveRuns: { query: vi.fn() },
      listBindings: { query: vi.fn() },
      refreshCodexQuota: { mutate: vi.fn() },
      refreshKimiCodeQuota: { mutate: vi.fn() },
      selectAccountForAgent: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));

const NOW = Date.UTC(2026, 10, 18, 4, 0);
const HOUR = 60 * 60 * 1000;

const accounts = [
  { email: 'a@x.com', id: 'acc-a', provider: 'claude-code' },
  { email: 'b@x.com', id: 'acc-b', provider: 'codex' },
];

const readingsById: Record<string, any[]> = {
  'acc-a': [
    {
      capturedAt: NOW - HOUR,
      limitType: 'session',
      resetsAt: NOW + 30 * 60 * 1000,
      scopeKey: '',
      utilization: 100,
    },
    {
      capturedAt: NOW - HOUR,
      limitType: 'weekly_all',
      resetsAt: NOW + 72 * HOUR,
      scopeKey: '',
      utilization: 40,
    },
  ],
  'acc-b': [
    {
      capturedAt: NOW - HOUR,
      limitType: 'session',
      resetsAt: NOW + 2 * HOUR,
      scopeKey: '',
      utilization: 12,
    },
  ],
};

describe('quota command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.agentQuota))
      for (const fn of Object.values(method)) (fn as ReturnType<typeof vi.fn>).mockReset();
    mockTrpcClient.agentQuota.listAccounts.query.mockResolvedValue(accounts);
    mockTrpcClient.agentQuota.getLatestReadings.query.mockImplementation(
      async ({ accountId }: { accountId: string }) => readingsById[accountId] ?? [],
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerQuotaCommand(program);
    return program.parseAsync(['node', 'test', 'quota', ...args]);
  };

  const lastJson = () => JSON.parse(consoleSpy.mock.calls.at(-1)![0]);

  it('lists accounts with folded status', async () => {
    await run('list', '--json');

    const views = lastJson();
    expect(views.map((v: any) => [v.accountId, v.status])).toEqual([
      ['acc-a', 'exhausted'],
      ['acc-b', 'ok'],
    ]);
    expect(views[0].unavailableUntil).toBe(new Date(NOW + 30 * 60 * 1000).toISOString());
    expect(views[0].windows.map((w: any) => w.kind)).toEqual(['session', 'weekly']);
  });

  it('filters list by provider', async () => {
    await run('list', '--provider', 'codex', '--json');

    expect(lastJson().map((v: any) => v.accountId)).toEqual(['acc-b']);
  });

  it('resolves the current account of an agent', async () => {
    mockTrpcClient.agentQuota.selectAccountForAgent.query.mockResolvedValue({
      accountId: 'acc-a',
      reason: 'pinned',
    });
    mockTrpcClient.agentQuota.listBindings.query.mockResolvedValue([
      { accountId: 'acc-a', role: 'pinned' },
      { accountId: 'acc-b', role: 'disabled' },
    ]);

    await run('agent', 'agt_1', '--device', 'dev-1', '--json');

    expect(mockTrpcClient.agentQuota.selectAccountForAgent.query).toHaveBeenCalledWith({
      agentId: 'agt_1',
      deviceId: 'dev-1',
      provider: undefined,
    });
    const result = lastJson();
    expect(result.current).toMatchObject({
      accountId: 'acc-a',
      reason: 'pinned',
      status: 'exhausted',
    });
    expect(result.accounts.map((v: any) => v.accountId)).toEqual(['acc-a']);
  });

  it('refuses to refresh claude-code on demand', async () => {
    await run('refresh', '--device', 'dev-1', '--provider', 'claude-code');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.agentQuota.refreshCodexQuota.mutate).not.toHaveBeenCalled();
  });

  it('refreshes codex through the device', async () => {
    mockTrpcClient.agentQuota.refreshCodexQuota.mutate.mockResolvedValue({ status: 'ok' });

    await run('refresh', '--device', 'dev-1', '--provider', 'codex', '--json');

    expect(mockTrpcClient.agentQuota.refreshCodexQuota.mutate).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      force: true,
    });
  });
});

describe('buildAccountView', () => {
  const account = { id: 'acc', provider: 'claude-code' };

  it('treats a window that already reset as empty', () => {
    const view = buildAccountView(
      account,
      [
        {
          capturedAt: NOW - 6 * HOUR,
          limitType: 'session',
          resetsAt: NOW - HOUR,
          scopeKey: '',
          utilization: 100,
        },
      ],
      NOW,
    );
    expect(view.status).toBe('ok');
    expect(view.windows[0].utilization).toBe(0);
  });

  it('benches on a full weekly and warns near the limit', () => {
    expect(
      buildAccountView(
        account,
        [
          {
            capturedAt: NOW,
            limitType: 'weekly_all',
            resetsAt: NOW + HOUR,
            scopeKey: '',
            utilization: 100,
          },
        ],
        NOW,
      ).status,
    ).toBe('exhausted');
    expect(
      buildAccountView(
        account,
        [
          {
            capturedAt: NOW,
            limitType: 'session',
            resetsAt: NOW + HOUR,
            scopeKey: '',
            utilization: 85,
          },
        ],
        NOW,
      ).status,
    ).toBe('warning');
  });

  it('reports unknown without readings', () => {
    expect(buildAccountView(account, [], NOW).status).toBe('unknown');
  });
});
