import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerConfigCommand } from './config';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    usage: {
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
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('config command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.user.getUserState.query.mockReset();
    mockTrpcClient.usage.findByMonth.query.mockReset();
    mockTrpcClient.usage.findAndGroupByDay.query.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
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

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(state, null, 2));
    });
  });

  describe('usage', () => {
    it('should display monthly usage', async () => {
      mockTrpcClient.usage.findByMonth.query.mockResolvedValue({ totalTokens: 1000 });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage']);

      expect(mockTrpcClient.usage.findByMonth.query).toHaveBeenCalled();
    });

    it('should display daily usage', async () => {
      mockTrpcClient.usage.findAndGroupByDay.query.mockResolvedValue([
        { date: '2024-01-01', totalTokens: 100 },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage', '--daily']);

      expect(mockTrpcClient.usage.findAndGroupByDay.query).toHaveBeenCalled();
    });

    it('should pass month param', async () => {
      mockTrpcClient.usage.findByMonth.query.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage', '--month', '2024-01']);

      expect(mockTrpcClient.usage.findByMonth.query).toHaveBeenCalledWith({ mo: '2024-01' });
    });

    it('should output JSON', async () => {
      const data = { totalTokens: 1000 };
      mockTrpcClient.usage.findByMonth.query.mockResolvedValue(data);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'usage', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    });
  });
});
