import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAgentGroupCommand } from './agent-group';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    group: {
      addAgentsToGroup: { mutate: vi.fn() },
      createGroup: { mutate: vi.fn() },
      deleteGroup: { mutate: vi.fn() },
      duplicateGroup: { mutate: vi.fn() },
      getGroupDetail: { query: vi.fn() },
      getGroups: { query: vi.fn() },
      removeAgentsFromGroup: { mutate: vi.fn() },
      updateGroup: { mutate: vi.fn() },
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

describe('agent-group command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.group)) {
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
    registerAgentGroupCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list agent groups', async () => {
      mockTrpcClient.group.getGroups.query.mockResolvedValue([
        { agents: [{ id: 'a1' }], id: 'g1', title: 'Group 1' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent-group', 'list']);

      expect(mockTrpcClient.group.getGroups.query).toHaveBeenCalled();
    });

    it('should show empty message when no groups', async () => {
      mockTrpcClient.group.getGroups.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent-group', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No agent groups found.');
    });
  });

  describe('view', () => {
    it('should view group details', async () => {
      mockTrpcClient.group.getGroupDetail.query.mockResolvedValue({
        agents: [{ id: 'a1', title: 'Agent 1' }],
        id: 'g1',
        title: 'Group 1',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent-group', 'view', 'g1']);

      expect(mockTrpcClient.group.getGroupDetail.query).toHaveBeenCalledWith({ id: 'g1' });
    });
  });

  describe('create', () => {
    it('should create a group', async () => {
      mockTrpcClient.group.createGroup.mutate.mockResolvedValue({ group: { id: 'g1' } });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent-group', 'create', '-t', 'My Group']);

      expect(mockTrpcClient.group.createGroup.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Group' }),
      );
    });
  });

  describe('delete', () => {
    it('should delete a group', async () => {
      mockTrpcClient.group.deleteGroup.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent-group', 'delete', 'g1', '--yes']);

      expect(mockTrpcClient.group.deleteGroup.mutate).toHaveBeenCalledWith({ id: 'g1' });
    });
  });

  describe('duplicate', () => {
    it('should duplicate a group', async () => {
      mockTrpcClient.group.duplicateGroup.mutate.mockResolvedValue({ groupId: 'g2' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent-group', 'duplicate', 'g1', '-t', 'Copy']);

      expect(mockTrpcClient.group.duplicateGroup.mutate).toHaveBeenCalledWith({
        groupId: 'g1',
        newTitle: 'Copy',
      });
    });
  });

  describe('add-agents', () => {
    it('should add agents to group', async () => {
      mockTrpcClient.group.addAgentsToGroup.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent-group',
        'add-agents',
        'g1',
        '--agent-ids',
        'a1,a2',
      ]);

      expect(mockTrpcClient.group.addAgentsToGroup.mutate).toHaveBeenCalledWith({
        agentIds: ['a1', 'a2'],
        groupId: 'g1',
      });
    });
  });

  describe('remove-agents', () => {
    it('should remove agents from group', async () => {
      mockTrpcClient.group.removeAgentsFromGroup.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent-group',
        'remove-agents',
        'g1',
        '--agent-ids',
        'a1',
        '--yes',
      ]);

      expect(mockTrpcClient.group.removeAgentsFromGroup.mutate).toHaveBeenCalledWith({
        agentIds: ['a1'],
        deleteVirtualAgents: true,
        groupId: 'g1',
      });
    });
  });
});
