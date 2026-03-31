import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSessionGroupCommand } from './session-group';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    sessionGroup: {
      createSessionGroup: { mutate: vi.fn() },
      getSessionGroup: { query: vi.fn() },
      removeSessionGroup: { mutate: vi.fn() },
      updateSessionGroup: { mutate: vi.fn() },
      updateSessionGroupOrder: { mutate: vi.fn() },
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

describe('session-group command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.sessionGroup)) {
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
    registerSessionGroupCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list session groups', async () => {
      mockTrpcClient.sessionGroup.getSessionGroup.query.mockResolvedValue([
        { id: 'sg1', name: 'Group 1', sort: 0 },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'list']);

      expect(mockTrpcClient.sessionGroup.getSessionGroup.query).toHaveBeenCalled();
    });

    it('should show empty message when no groups', async () => {
      mockTrpcClient.sessionGroup.getSessionGroup.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No session groups found.');
    });
  });

  describe('create', () => {
    it('should create a session group', async () => {
      mockTrpcClient.sessionGroup.createSessionGroup.mutate.mockResolvedValue('sg1');

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'create', '-n', 'My Group']);

      expect(mockTrpcClient.sessionGroup.createSessionGroup.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Group' }),
      );
    });
  });

  describe('edit', () => {
    it('should update a session group', async () => {
      mockTrpcClient.sessionGroup.updateSessionGroup.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'edit', 'sg1', '-n', 'New Name']);

      expect(mockTrpcClient.sessionGroup.updateSessionGroup.mutate).toHaveBeenCalledWith({
        id: 'sg1',
        value: expect.objectContaining({ name: 'New Name' }),
      });
    });

    it('should error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'edit', 'sg1']);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete a session group', async () => {
      mockTrpcClient.sessionGroup.removeSessionGroup.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'delete', 'sg1', '--yes']);

      expect(mockTrpcClient.sessionGroup.removeSessionGroup.mutate).toHaveBeenCalledWith({
        id: 'sg1',
      });
    });
  });

  describe('sort', () => {
    it('should update sort order', async () => {
      mockTrpcClient.sessionGroup.updateSessionGroupOrder.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'session-group', 'sort', '--map', 'sg1:0,sg2:1']);

      expect(mockTrpcClient.sessionGroup.updateSessionGroupOrder.mutate).toHaveBeenCalledWith({
        sortMap: [
          { id: 'sg1', sort: 0 },
          { id: 'sg2', sort: 1 },
        ],
      });
    });
  });
});
