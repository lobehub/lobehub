import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerConfigCommand } from './config';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
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

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
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

    // Every command resolves its scope from this env var, so reporting it is
    // what lets a caller — usually an agent editing its own config — tell a
    // real "not found" from "I'm looking in the wrong workspace".
    it('should report the active workspace scope', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws-42';
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('workspace ws-42'));
    });

    it('should report personal scope when no workspace is set', async () => {
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('personal'));
    });

    it('should carry the workspace scope into --json output', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws-42';
      mockTrpcClient.user.getUserState.query.mockResolvedValue({ userId: 'u1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { userId: 'u1', scope: 'workspace', scopeSource: 'env', workspaceId: 'ws-42' },
          null,
          2,
        ),
      );
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
});
