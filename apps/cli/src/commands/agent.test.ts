import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerAgentCommand } from './agent';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agent: {
      createAgent: { mutate: vi.fn() },
      duplicateAgent: { mutate: vi.fn() },
      getAgentConfigById: { query: vi.fn() },
      queryAgents: { query: vi.fn() },
      removeAgent: { mutate: vi.fn() },
      updateAgentConfig: { mutate: vi.fn() },
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

describe('agent command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.agent)) {
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
    registerAgentCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display agents in table format', async () => {
      mockTrpcClient.agent.queryAgents.query.mockResolvedValue([
        { id: 'a1', model: 'gpt-4', title: 'My Agent' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + row
    });

    it('should filter by keyword', async () => {
      mockTrpcClient.agent.queryAgents.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'list', '-k', 'test']);

      expect(mockTrpcClient.agent.queryAgents.query).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'test' }),
      );
    });

    it('should output JSON', async () => {
      const agents = [{ id: 'a1', title: 'Test' }];
      mockTrpcClient.agent.queryAgents.query.mockResolvedValue(agents);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(agents, null, 2));
    });
  });

  describe('view', () => {
    it('should display agent config', async () => {
      mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
        model: 'gpt-4',
        systemRole: 'You are helpful.',
        title: 'Test Agent',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'view', 'a1']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Agent'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('create', () => {
    it('should create an agent', async () => {
      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({
        agentId: 'a-new',
        sessionId: 's1',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'create',
        '--title',
        'My Agent',
        '--model',
        'gpt-4',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ model: 'gpt-4', title: 'My Agent' }),
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('a-new'));
    });
  });

  describe('edit', () => {
    it('should update agent config', async () => {
      mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1', '--title', 'Updated']);

      expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        value: { title: 'Updated' },
      });
    });

    it('should exit when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete with --yes', async () => {
      mockTrpcClient.agent.removeAgent.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'delete', 'a1', '--yes']);

      expect(mockTrpcClient.agent.removeAgent.mutate).toHaveBeenCalledWith({ agentId: 'a1' });
    });
  });

  describe('duplicate', () => {
    it('should duplicate an agent', async () => {
      mockTrpcClient.agent.duplicateAgent.mutate.mockResolvedValue({ agentId: 'a-dup' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'duplicate', 'a1', '--title', 'Copy']);

      expect(mockTrpcClient.agent.duplicateAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', newTitle: 'Copy' }),
      );
    });
  });
});
