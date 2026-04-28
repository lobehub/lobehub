import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCronCommand } from './cron';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentCronJob: {
      batchUpdateStatus: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      findById: { query: vi.fn() },
      getStats: { query: vi.fn() },
      list: { query: vi.fn() },
      resetExecutions: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
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

describe('cron command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.agentCronJob)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerCronCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list cron jobs', async () => {
      mockTrpcClient.agentCronJob.list.query.mockResolvedValue({
        data: [{ enabled: true, id: 'c1', name: 'Test Job', schedule: '* * * * *' }],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'list']);

      expect(mockTrpcClient.agentCronJob.list.query).toHaveBeenCalled();
    });

    it('should filter by agent-id', async () => {
      mockTrpcClient.agentCronJob.list.query.mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'list', '--agent-id', 'a1']);

      expect(mockTrpcClient.agentCronJob.list.query).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1' }),
      );
    });
  });

  describe('view', () => {
    it('should view cron job details', async () => {
      mockTrpcClient.agentCronJob.findById.query.mockResolvedValue({
        data: { enabled: true, id: 'c1', name: 'Test', schedule: '* * * * *' },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'view', 'c1']);

      expect(mockTrpcClient.agentCronJob.findById.query).toHaveBeenCalledWith({ id: 'c1' });
    });
  });

  describe('create', () => {
    it('should create a cron job', async () => {
      mockTrpcClient.agentCronJob.create.mutate.mockResolvedValue({ data: { id: 'c1' } });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'cron',
        'create',
        '--agent-id',
        'a1',
        '-s',
        '* * * * *',
        '-n',
        'My Job',
      ]);

      expect(mockTrpcClient.agentCronJob.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', cronPattern: '* * * * *', name: 'My Job' }),
      );
    });
  });

  describe('delete', () => {
    it('should delete a cron job', async () => {
      mockTrpcClient.agentCronJob.delete.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'delete', 'c1', '--yes']);

      expect(mockTrpcClient.agentCronJob.delete.mutate).toHaveBeenCalledWith({ id: 'c1' });
    });
  });

  describe('toggle', () => {
    it('should batch enable cron jobs', async () => {
      mockTrpcClient.agentCronJob.batchUpdateStatus.mutate.mockResolvedValue({
        data: { updatedCount: 2 },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'toggle', 'c1', 'c2', '--enable']);

      expect(mockTrpcClient.agentCronJob.batchUpdateStatus.mutate).toHaveBeenCalledWith({
        enabled: true,
        ids: ['c1', 'c2'],
      });
    });
  });

  describe('reset', () => {
    it('should reset execution count', async () => {
      mockTrpcClient.agentCronJob.resetExecutions.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'reset', 'c1', '--max', '100']);

      expect(mockTrpcClient.agentCronJob.resetExecutions.mutate).toHaveBeenCalledWith({
        id: 'c1',
        newMaxExecutions: 100,
      });
    });
  });

  describe('stats', () => {
    it('should get stats', async () => {
      mockTrpcClient.agentCronJob.getStats.query.mockResolvedValue({
        data: { totalJobs: 5, totalExecutions: 100 },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'cron', 'stats']);

      expect(mockTrpcClient.agentCronJob.getStats.query).toHaveBeenCalled();
    });
  });
});
