import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerSearchCommand } from './search';

const { mockTrpcClient, mockToolsTrpcClient } = vi.hoisted(() => ({
  mockToolsTrpcClient: {
    search: {
      webSearch: { query: vi.fn() },
    },
  },
  mockTrpcClient: {
    search: {
      query: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient, getToolsTrpcClient: mockGetToolsTrpcClient } = vi.hoisted(
  () => ({
    getToolsTrpcClient: vi.fn(),
    getTrpcClient: vi.fn(),
  }),
);

vi.mock('../api/client', () => ({
  getToolsTrpcClient: mockGetToolsTrpcClient,
  getTrpcClient: mockGetTrpcClient,
}));
describe('search command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockGetToolsTrpcClient.mockResolvedValue(mockToolsTrpcClient);
    mockTrpcClient.search.query.query.mockReset();
    mockToolsTrpcClient.search.webSearch.query.mockReset();
    vi.mocked(log.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerSearchCommand(program);
    return program;
  }

  it('should search with query string', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'hello']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hello' }),
    );
  });

  it('should filter by type', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'test', '--type', 'agent']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'test', type: 'agent' }),
    );
  });

  it('should respect --limit flag', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'test', '-L', '5']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ limitPerType: 5 }),
    );
  });

  it('should output JSON when --json flag is used', async () => {
    vi.stubEnv('LOBEHUB_SERVER', 'https://app.lobehub.com');
    vi.stubEnv('LOBEHUB_WORKSPACE_ID', '');
    const results = [
      { id: 'agt_1', title: 'Test', type: 'agent' },
      { agentId: 'agt_1', id: 'tpc_1', title: 'Chat', type: 'topic' },
      { id: 'x', type: 'unknown' },
    ];
    mockTrpcClient.search.query.query.mockResolvedValue(results);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'test', '--json']);

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify(
        [
          { ...results[0], url: 'https://app.lobehub.com/agent/agt_1' },
          { ...results[1], url: 'https://app.lobehub.com/agent/agt_1/tpc_1' },
          results[2],
        ],
        null,
        2,
      ),
    );
  });

  it('should show message when no results found', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'nothing']);

    expect(consoleSpy).toHaveBeenCalledWith('No results found.');
  });

  it('should display grouped results for array response', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([
      { id: '1', title: 'Agent 1', type: 'agent' },
      { id: '2', title: 'Topic 1', type: 'topic' },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'test']);

    // Should display group headers
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agent'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('topic'));
  });

  it('should display grouped results for object response', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue({
      agents: [{ id: '1', title: 'Agent 1' }],
      topics: [{ id: '2', title: 'Topic 1' }],
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'test']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agents'));
  });

  it('should reject invalid type', async () => {
    const program = createProgram();
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy.mockImplementation(() => {
      throw new Error('process.exit');
    });
    await expect(
      program.parseAsync(['node', 'test', 'search', '-q', 'test', '--type', 'invalid']),
    ).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.search.query.query).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('should surface web search provider failures for non-JSON output', async () => {
    mockToolsTrpcClient.search.webSearch.query.mockResolvedValue({
      costTime: 0,
      errorDetail: 'All search providers failed',
      query: 'broken',
      resultNumbers: 0,
      results: [],
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-w', '-q', 'broken']);

    expect(log.error).toHaveBeenCalledWith('All search providers failed');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should keep JSON web search failure output and exit nonzero', async () => {
    const failure = {
      costTime: 0,
      errorDetail: 'All search providers failed',
      query: 'broken',
      resultNumbers: 0,
      results: [],
    };
    mockToolsTrpcClient.search.webSearch.query.mockResolvedValue(failure);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-w', '-q', 'broken', '--json']);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(failure, null, 2));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('opts untyped searches into goals', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([
      { id: 'goal_1', status: 'paused', title: 'Replica (STAMP)', type: 'goal' },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'STAMP']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ includeGoals: true, query: 'STAMP' }),
    );
    const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('goal_1');
  });

  it.each(['goal', 'task'])('accepts the %s type', async (type) => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', '-q', 'STAMP', '-t', type]);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.not.objectContaining({ includeGoals: true }),
    );
    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ type }),
    );
  });
});
