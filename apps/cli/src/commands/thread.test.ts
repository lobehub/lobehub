import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerThreadCommand } from './thread';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    thread: {
      getThread: { query: vi.fn() },
      getThreads: { query: vi.fn() },
      removeThread: { mutate: vi.fn() },
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

describe('thread command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.thread)) {
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
    registerThreadCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list threads by topic', async () => {
      mockTrpcClient.thread.getThreads.query.mockResolvedValue([
        { id: 't1', title: 'Thread 1', type: 'standalone' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'thread', 'list', '--topic-id', 'topic1']);

      expect(mockTrpcClient.thread.getThreads.query).toHaveBeenCalledWith({ topicId: 'topic1' });
    });

    it('should show empty message when no threads', async () => {
      mockTrpcClient.thread.getThreads.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'thread', 'list', '--topic-id', 'topic1']);

      expect(consoleSpy).toHaveBeenCalledWith('No threads found.');
    });
  });

  describe('list-all', () => {
    it('should list all threads', async () => {
      mockTrpcClient.thread.getThread.query.mockResolvedValue([
        { id: 't1', title: 'Thread 1', type: 'standalone' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'thread', 'list-all']);

      expect(mockTrpcClient.thread.getThread.query).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a thread', async () => {
      mockTrpcClient.thread.removeThread.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'thread', 'delete', 't1', '--yes']);

      expect(mockTrpcClient.thread.removeThread.mutate).toHaveBeenCalledWith({
        id: 't1',
        removeChildren: undefined,
      });
    });

    it('should delete with remove-children flag', async () => {
      mockTrpcClient.thread.removeThread.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'thread',
        'delete',
        't1',
        '--remove-children',
        '--yes',
      ]);

      expect(mockTrpcClient.thread.removeThread.mutate).toHaveBeenCalledWith({
        id: 't1',
        removeChildren: true,
      });
    });
  });
});
