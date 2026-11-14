import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkspaceModule from '../api/workspace';
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
});
