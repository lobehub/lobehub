import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkspaceModule from '../api/workspace';
import { log } from '../utils/logger';
import { registerAgentCommand } from './agent';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agent: {
      createAgent: { mutate: vi.fn() },
      getAgentConfigById: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
// Personal scope, so the app URL does not depend on the shell's LOBEHUB_WORKSPACE_ID.
vi.mock('../api/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  resolveWorkspaceId: () => undefined,
}));

describe('agent create', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.agent.createAgent.mutate.mockReset();
    mockTrpcClient.agent.getAgentConfigById.query.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);
    return program;
  }

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

  it('omits visibility when the flag is not passed, keeping the server default', async () => {
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'create', '--title', 'x']);

    const input = mockTrpcClient.agent.createAgent.mutate.mock.calls[0][0];
    expect(input).not.toHaveProperty('visibility');
    expect(mockTrpcClient.agent.getAgentConfigById.query).not.toHaveBeenCalled();
  });

  it.each(['private', 'public'])('passes --visibility %s through to the server', async (v) => {
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'create', '-t', 'x', '--visibility', v]);

    expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith({
      config: { title: 'x' },
      visibility: v,
    });
    expect(consoleSpy).toHaveBeenCalledWith(`  Visibility: ${v}`);
  });

  it('passes repeated --tag flags as config.tags, trimmed and without duplicates', async () => {
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'create',
      '-t',
      'x',
      '--tag',
      'lobe-pet',
      '--tag',
      ' pet:dafeiyu ',
      '--tag',
      'lobe-pet',
      '--tag',
      ' ',
    ]);

    expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith({
      config: { tags: ['lobe-pet', 'pet:dafeiyu'], title: 'x' },
    });
  });

  it('sends no tags without --tag', async () => {
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'create', '-t', 'x']);

    expect(mockTrpcClient.agent.createAgent.mutate.mock.calls[0][0].config).not.toHaveProperty(
      'tags',
    );
  });

  it('rejects an unknown --visibility value before calling the server', async () => {
    const program = createProgram();
    program.exitOverride();
    program.commands.forEach((c) => c.exitOverride());
    const agentCmd = program.commands.find((c) => c.name() === 'agent')!;
    agentCmd.commands.forEach((c) => c.exitOverride().configureOutput({ writeErr: () => {} }));

    await expect(
      program.parseAsync(['node', 'test', 'agent', 'create', '-t', 'x', '--visibility', 'team']),
    ).rejects.toThrow(/Allowed choices are private, public/);
    expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
  });

  it('prints the created agent as JSON with the persisted visibility', async () => {
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });
    mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
      id: 'a-new',
      title: 'x',
      visibility: 'private',
      workspaceId: 'ws-1',
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'create',
      '-t',
      'x',
      '--visibility',
      'private',
      '--json',
    ]);

    expect(mockTrpcClient.agent.getAgentConfigById.query).toHaveBeenCalledWith({
      agentId: 'a-new',
    });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual({
      id: 'a-new',
      title: 'x',
      url: expect.stringContaining('/agent/a-new'),
      visibility: 'private',
      workspaceId: 'ws-1',
    });
  });

  it('reports the server-chosen visibility in JSON when the flag is omitted', async () => {
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });
    mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
      id: 'a-new',
      visibility: 'public',
      workspaceId: null,
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'create', '--json', 'id,visibility']);

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual({ id: 'a-new', visibility: 'public' });
  });

  it('still prints the id when the read-back fails, without echoing the flag', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'a-new' });
    mockTrpcClient.agent.getAgentConfigById.query.mockRejectedValue(new Error('fetch failed'));

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'create',
      '-t',
      'x',
      '--visibility',
      'private',
      '--json',
      'id,visibility',
    ]);

    expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ id: 'a-new', visibility: null });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not read it back'));
    warnSpy.mockRestore();
  });
});
