import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkspaceModule from '../api/workspace';
import { log } from '../utils/logger';
import { registerAgentCommand } from './agent';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agent: {
      queryAgents: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  resolveWorkspaceId: () => undefined,
}));

describe('agent list --tag', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.agent.queryAgents.query.mockReset();
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);
    return program.parseAsync(['node', 'test', 'agent', 'list', ...args]);
  };

  it('passes the tag to the server so it filters before the limit', async () => {
    await run('--tag', ' lobe-pet ', '--json');

    expect(mockTrpcClient.agent.queryAgents.query).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'lobe-pet' }),
    );
  });

  it('sends no tag when the option is absent or blank', async () => {
    await run();
    await run('--tag', '  ');

    for (const [input] of mockTrpcClient.agent.queryAgents.query.mock.calls) {
      expect(input).not.toHaveProperty('tag');
    }
  });

  it('prints only rows carrying the tag', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([
      { id: 'pet', tags: ['lobe-pet'], title: 'Pet' },
      { id: 'crm', tags: [], title: 'CRM' },
    ]);

    await run('--tag', 'lobe-pet', '--json');

    const out = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(out.map((a: { id: string }) => a.id)).toEqual(['pet']);
  });

  it('prints nothing and warns when an older server ignored the tag', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([
      { id: 'crm', title: 'CRM' },
      { id: 'coder', title: 'Coder' },
    ]);

    await run('--tag', 'lobe-pet', '--json');

    expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not filter agents by tag'));
    warn.mockRestore();
  });

  it('leaves the list untouched without --tag', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([{ id: 'crm', title: 'CRM' }]);

    await run('--json');

    expect(JSON.parse(consoleSpy.mock.calls[0][0]).map((a: { id: string }) => a.id)).toEqual([
      'crm',
    ]);
  });
});
