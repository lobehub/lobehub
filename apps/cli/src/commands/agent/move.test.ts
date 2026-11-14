import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatModule from '../../utils/format';
import { log } from '../../utils/logger';
import { registerAgentMoveCommands } from './move';

const { mockTrpcClient, mockConfirm } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockTrpcClient: {
    agent: { transferAgents: { mutate: vi.fn() } },
    home: { updateAgentSessionGroupId: { mutate: vi.fn() } },
    workspace: { list: { query: vi.fn() } },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));
vi.mock('../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof FormatModule>()),
  confirm: mockConfirm,
}));

const WORKSPACES = [{ id: 'ws-1', name: 'Team', slug: 'team' }];

describe('agent transfer / move-group', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.spyOn(log, 'error').mockImplementation(() => {});
    mockTrpcClient.workspace.list.query.mockResolvedValue(WORKSPACES);
    mockConfirm.mockResolvedValue(true);
    mockTrpcClient.home.updateAgentSessionGroupId.mutate.mockResolvedValue({ id: 'a1' });
    mockTrpcClient.agent.transferAgents.mutate.mockResolvedValue([
      { agentId: 'a1', slug: null, transferJobId: 'job-1' },
    ]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerAgentMoveCommands(program.command('agent'));
    return program.parseAsync(['node', 'test', 'agent', ...args]);
  };

  describe('transfer', () => {
    it('resolves a workspace slug to its id before transferring', async () => {
      await run('transfer', 'a1', 'a2', '--to', 'team', '--visibility', 'public', '--yes');

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.agent.transferAgents.mutate).toHaveBeenCalledWith({
        agentIds: ['a1', 'a2'],
        targetVisibility: 'public',
        targetWorkspaceId: 'ws-1',
      });
    });

    it('defaults to private visibility when transferring to a workspace', async () => {
      await run('transfer', 'a1', '--to', 'team', '--yes');

      expect(mockTrpcClient.agent.transferAgents.mutate).toHaveBeenCalledWith({
        agentIds: ['a1'],
        targetVisibility: 'private',
        targetWorkspaceId: 'ws-1',
      });
    });

    it('transfers to the personal account with a null target', async () => {
      await run('transfer', 'a1', '--personal', '--yes');

      expect(mockTrpcClient.workspace.list.query).not.toHaveBeenCalled();
      expect(mockTrpcClient.agent.transferAgents.mutate).toHaveBeenCalledWith({
        agentIds: ['a1'],
        targetVisibility: undefined,
        targetWorkspaceId: null,
      });
    });

    it('does nothing when the confirmation is declined', async () => {
      mockConfirm.mockResolvedValue(false);

      await run('transfer', 'a1', '--to', 'ws-1');

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockTrpcClient.agent.transferAgents.mutate).not.toHaveBeenCalled();
    });

    it.each([
      ['no target', ['transfer', 'a1', '--yes']],
      ['both targets', ['transfer', 'a1', '--to', 'team', '--personal', '--yes']],
      ['visibility with --personal', ['transfer', 'a1', '--personal', '--visibility', 'public']],
    ])('rejects %s', async (_, args) => {
      await run(...args);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.agent.transferAgents.mutate).not.toHaveBeenCalled();
    });

    it('prints the server results with --json', async () => {
      await run('transfer', 'a1', '--personal', '--yes', '--json');

      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([
        { agentId: 'a1', slug: null, transferJobId: 'job-1' },
      ]);
    });
  });

  describe('move-group', () => {
    it('moves an agent into a group', async () => {
      await run('move-group', 'a1', 'g1');

      expect(mockTrpcClient.home.updateAgentSessionGroupId.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        sessionGroupId: 'g1',
      });
    });

    it('removes the agent from its group with `default`', async () => {
      await run('move-group', 'a1', 'default');

      expect(mockTrpcClient.home.updateAgentSessionGroupId.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        sessionGroupId: null,
      });
    });

    it('fails when no agent matched in the current scope', async () => {
      mockTrpcClient.home.updateAgentSessionGroupId.mutate.mockResolvedValue(undefined);

      await run('move-group', 'missing', 'g1');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});
