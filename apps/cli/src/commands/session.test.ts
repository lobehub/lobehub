import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerSessionCommand } from './session';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    session: {
      createSession: { mutate: vi.fn() },
      getSessions: { query: vi.fn() },
      removeSession: { mutate: vi.fn() },
      searchSessions: { query: vi.fn() },
      updateSession: { mutate: vi.fn() },
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

describe('session command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.session)) {
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
    registerSessionCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display sessions', async () => {
      mockTrpcClient.session.getSessions.query.mockResolvedValue([
        { id: 's1', title: 'Chat 1', type: 'agent', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should pass pagination params', async () => {
      mockTrpcClient.session.getSessions.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session', 'list', '-L', '10', '--page', '2']);

      expect(mockTrpcClient.session.getSessions.query).toHaveBeenCalledWith({
        current: 2,
        pageSize: 10,
      });
    });
  });

  describe('search', () => {
    it('should search sessions', async () => {
      mockTrpcClient.session.searchSessions.query.mockResolvedValue([{ id: 's1', title: 'Found' }]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session', 'search', 'test']);

      expect(mockTrpcClient.session.searchSessions.query).toHaveBeenCalledWith({
        keywords: 'test',
      });
    });
  });

  describe('create', () => {
    it('should create a session', async () => {
      mockTrpcClient.session.createSession.mutate.mockResolvedValue({ id: 's-new' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'session',
        'create',
        '--title',
        'New Chat',
        '--type',
        'agent',
      ]);

      expect(mockTrpcClient.session.createSession.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent' }),
      );
    });
  });

  describe('edit', () => {
    it('should update session', async () => {
      mockTrpcClient.session.updateSession.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session', 'edit', 's1', '--title', 'Updated']);

      expect(mockTrpcClient.session.updateSession.mutate).toHaveBeenCalledWith({
        id: 's1',
        value: { title: 'Updated' },
      });
    });

    it('should exit when no changes', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session', 'edit', 's1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete with --yes', async () => {
      mockTrpcClient.session.removeSession.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session', 'delete', 's1', '--yes']);

      expect(mockTrpcClient.session.removeSession.mutate).toHaveBeenCalledWith({ id: 's1' });
    });
  });
});
