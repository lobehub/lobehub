import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSearchCommand } from './search';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    search: {
      query: { query: vi.fn() },
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

describe('search command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.search.query.query.mockReset();
  });

  afterEach(() => {
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
    await program.parseAsync(['node', 'test', 'search', 'hello']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hello' }),
    );
  });

  it('should filter by type', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', 'test', '--type', 'agent']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'test', type: 'agent' }),
    );
  });

  it('should respect --limit flag', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', 'test', '-L', '5']);

    expect(mockTrpcClient.search.query.query).toHaveBeenCalledWith(
      expect.objectContaining({ limitPerType: 5 }),
    );
  });

  it('should output JSON when --json flag is used', async () => {
    const results = [{ id: '1', title: 'Test', type: 'agent' }];
    mockTrpcClient.search.query.query.mockResolvedValue(results);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', 'test', '--json']);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(results, null, 2));
  });

  it('should show message when no results found', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', 'nothing']);

    expect(consoleSpy).toHaveBeenCalledWith('No results found.');
  });

  it('should display grouped results for array response', async () => {
    mockTrpcClient.search.query.query.mockResolvedValue([
      { id: '1', title: 'Agent 1', type: 'agent' },
      { id: '2', title: 'Topic 1', type: 'topic' },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'search', 'test']);

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
    await program.parseAsync(['node', 'test', 'search', 'test']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agents'));
  });

  it('should reject invalid type', async () => {
    const program = createProgram();
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await program.parseAsync(['node', 'test', 'search', 'test', '--type', 'invalid']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    stderrSpy.mockRestore();
  });
});
