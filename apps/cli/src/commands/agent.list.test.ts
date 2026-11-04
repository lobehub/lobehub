import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
  mockTrpcClient.agent.queryAgents.query.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerAgentCommand(program);
  return program;
}

describe('agent list', () => {
  it('should display agents in table format', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([
      { id: 'a1', model: 'gpt-4', title: 'My Agent' },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list']);

    expect(consoleSpy).toHaveBeenCalledTimes(3); // header + row + paging footer
    expect(consoleSpy).toHaveBeenLastCalledWith(expect.stringContaining('no more pages'));
  });

  it('should request the given page as an offset', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list', '-L', '100', '--page', '3']);

    expect(mockTrpcClient.agent.queryAgents.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 200 }),
    );
  });

  it('should point at the next page after a full page', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([
      { id: 'a1', title: 'One' },
      { id: 'a2', title: 'Two' },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list', '-L', '2']);

    expect(consoleSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('Page 1 · 1-2 · next: --page 2'),
    );
  });

  it('should reject a --limit above the server cap', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list', '-L', '500']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.agent.queryAgents.query).not.toHaveBeenCalled();
  });

  it('should filter by keyword', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list', '-k', 'test']);

    expect(mockTrpcClient.agent.queryAgents.query).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'test' }),
    );
  });

  it('opts the inbox into the lookup, unlike callers that leave the default', async () => {
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list']);

    // `queryAgents` excludes the product-owned inbox unless a caller opts in,
    // so `lh agent list` must ask for it explicitly — this is the surface the
    // inbox is meant to appear on.
    expect(mockTrpcClient.agent.queryAgents.query).toHaveBeenCalledWith(
      expect.objectContaining({ includeInbox: true }),
    );
  });

  it('should output JSON', async () => {
    vi.stubEnv('LOBEHUB_SERVER', 'https://app.lobehub.com');
    vi.stubEnv('LOBEHUB_WORKSPACE_ID', '');
    const agents = [{ id: 'a1', title: 'Test' }];
    mockTrpcClient.agent.queryAgents.query.mockResolvedValue(agents);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'list', '--json']);

    expect(consoleSpy.mock.calls[0][0]).toContain('"url": "https://app.lobehub.com/agent/a1"');
  });
});
