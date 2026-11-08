import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerConfigCommand } from './config';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    auth: {
      getScope: { query: vi.fn() },
    },
    usage: {
      findAndGroupByDateRange: { query: vi.fn() },
      findAndGroupByDay: { query: vi.fn() },
      findByMonth: { query: vi.fn() },
    },
    user: {
      getUserState: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockGetOpenApi, mockResolveWorkspaceRef } = vi.hoisted(() => ({
  mockGetOpenApi: vi.fn(),
  mockResolveWorkspaceRef: vi.fn(async (ref?: string) => (ref ? `ws-${ref}` : undefined)),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/openapi', () => ({ getOpenApi: mockGetOpenApi }));
vi.mock('../api/workspaceRef', () => ({ resolveWorkspaceRef: mockResolveWorkspaceRef }));
// Scope resolution falls through to the persisted `workspace use` value, which
// must not leak the developer's own machine state into these assertions.
vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));
describe('config command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.LOBEHUB_WORKSPACE_ID;
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.user.getUserState.query.mockReset();
    mockTrpcClient.auth.getScope.query.mockReset();
    mockTrpcClient.auth.getScope.query.mockResolvedValue({
      scope: 'personal',
      source: 'personal',
      workspaceId: null,
    });
    mockTrpcClient.usage.findByMonth.query.mockReset();
    mockTrpcClient.usage.findAndGroupByDay.query.mockReset();
    mockTrpcClient.usage.findAndGroupByDateRange.query.mockReset();
    mockTrpcClient.usage.findAndGroupByDateRange.query.mockResolvedValue([]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (originalWorkspaceId === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = originalWorkspaceId;
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);
    return program;
  }

  describe('whoami', () => {
    it('should display user info', async () => {
      mockTrpcClient.user.getUserState.query.mockResolvedValue({
        email: 'test@example.com',
        fullName: 'Test User',
        userId: 'u1',
        username: 'testuser',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test User'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('testuser'));
    });

    it('should output JSON', async () => {
      const state = { email: 'test@example.com', userId: 'u1' };
      mockTrpcClient.user.getUserState.query.mockResolvedValue(state);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { ...state, scope: 'personal', scopeSource: 'personal', workspaceId: null },
          null,
          2,
        ),
      );
    });

    // The server reports the scope the request actually ran under, so a
    // workspace API key shows its own workspace even with no local scope set.
    it('should report the workspace scope the server resolved', async () => {
      mockTrpcClient.auth.getScope.query.mockResolvedValue({
        scope: 'workspace',
        source: 'apiKey',
        workspaceId: 'ws-42',
      });
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('workspace ws-42'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('(from apiKey)'));
    });

    // A header naming a workspace the caller cannot use is demoted to personal
    // on the server; the locally configured id must not be shown instead.
    it('should report personal when the server ignores the local workspace', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws-missing';
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('personal'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('ws-missing'));
    });

    it('should carry the server scope into --json output', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws-other';
      mockTrpcClient.auth.getScope.query.mockResolvedValue({
        scope: 'workspace',
        source: 'header',
        workspaceId: 'ws-42',
      });
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { userId: 'u1', scope: 'workspace', scopeSource: 'header', workspaceId: 'ws-42' },
          null,
          2,
        ),
      );
    });

    // Self-hosted servers older than this CLI have no `auth.getScope`; whoami
    // must still print the identity rather than failing outright.
    it('should fall back to the local scope when the server lacks auth.getScope', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws-local';
      mockTrpcClient.auth.getScope.query.mockRejectedValue(
        Object.assign(new Error('No "query"-procedure on path "auth.getScope"'), {
          data: { code: 'NOT_FOUND' },
        }),
      );
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { userId: 'u1', scope: 'workspace', scopeSource: 'env', workspaceId: 'ws-local' },
          null,
          2,
        ),
      );
    });

    it('should surface other auth.getScope failures', async () => {
      mockTrpcClient.auth.getScope.query.mockRejectedValue(
        Object.assign(new Error('boom'), { data: { code: 'INTERNAL_SERVER_ERROR' } }),
      );
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await expect(program.parseAsync(['node', 'test', 'whoami'])).rejects.toThrow('boom');
    });
  });

  describe('usage', () => {
    it('should display usage table', async () => {
      mockTrpcClient.usage.findAndGroupByDay.query.mockResolvedValue([
        {
          day: '2024-01-15',
          records: [{ model: 'claude-opus-4-6', totalInputTokens: 500, totalOutputTokens: 500 }],
          totalRequests: 1,
          totalSpend: 0.5,
          totalTokens: 1000,
        },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage']);

      expect(mockTrpcClient.usage.findAndGroupByDay.query).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2024-01-15'));
    });

    it('should pass month param', async () => {
      mockTrpcClient.usage.findAndGroupByDay.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage', '--month', '2024-01']);

      expect(mockTrpcClient.usage.findAndGroupByDay.query).toHaveBeenCalledWith({ mo: '2024-01' });
    });

    it('should output JSON with --json flag', async () => {
      const data = { totalTokens: 1000 };
      mockTrpcClient.usage.findByMonth.query.mockResolvedValue(data);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    });

    it('should output JSON daily with --json --daily', async () => {
      const data = [{ day: '2024-01-01', totalTokens: 100 }];
      mockTrpcClient.usage.findAndGroupByDay.query.mockResolvedValue(data);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage', '--json', '--daily']);

      expect(mockTrpcClient.usage.findAndGroupByDay.query).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    });
  });

  describe('usage quota', () => {
    const quota = {
      limit: 10,
      remaining: 3.8,
      resetsAt: '2026-11-30T00:00:00.000Z',
      source: 'personal',
      used: 6.2,
      usedRatio: 0.62,
    };

    const output = () => consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');

    beforeEach(() => mockGetOpenApi.mockReset());

    it('shows the used share of the allowance, what is left and when it resets', async () => {
      mockGetOpenApi.mockResolvedValue({ quota, scope: 'personal' });

      await createProgram().parseAsync(['node', 'test', 'usage', 'quota']);

      expect(mockGetOpenApi).toHaveBeenCalledWith('/usage', undefined);
      expect(output()).toContain('62% ($6.20 of $10.00)');
      expect(output()).toContain('Remaining: $3.80');
      expect(output()).toContain('Resets:    2026-11-30');
      expect(mockTrpcClient.usage.findAndGroupByDay.query).not.toHaveBeenCalled();
    });

    it('reads the workspace passed with --workspace', async () => {
      mockGetOpenApi.mockResolvedValue({ quota, scope: 'workspace' });

      await createProgram().parseAsync(['node', 'test', 'usage', 'quota', '--workspace', 'acme']);

      expect(mockGetOpenApi).toHaveBeenCalledWith('/usage', 'ws-acme');
    });

    it('prints the quota and scope as JSON', async () => {
      mockGetOpenApi.mockResolvedValue({ quota, remainingBalance: 3.8, scope: 'personal' });

      await createProgram().parseAsync(['node', 'test', 'usage', 'quota', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ quota, scope: 'personal' }, null, 2),
      );
    });

    it('says so when the server has no allowance', async () => {
      mockGetOpenApi.mockResolvedValue({ quota: null, scope: 'personal' });

      await createProgram().parseAsync(['node', 'test', 'usage', 'quota']);

      expect(output()).toContain('No usage allowance on this server.');
    });

    it('shows spend without a percentage when the allowance has no cap', async () => {
      mockGetOpenApi.mockResolvedValue({
        quota: { ...quota, limit: null, source: 'workspace_pool', usedRatio: null },
        scope: 'workspace',
      });

      await createProgram().parseAsync(['node', 'test', 'usage', 'quota']);

      expect(output()).toContain('$6.20 (no cap)');
      expect(output()).not.toContain('%');
    });
  });
});
