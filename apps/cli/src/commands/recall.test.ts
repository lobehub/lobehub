import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerRecallCommand } from './recall';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    search: {
      recall: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));

const emptyResult = {
  goals: [],
  messages: { hasMore: false, items: [] },
  pages: [],
  topics: [],
};

describe('recall command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.search.recall.query.mockReset();
    vi.mocked(log.error).mockClear();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerRecallCommand(program);
    return program;
  }

  const output = () => consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');

  it('sends the query, window, types and options', async () => {
    mockTrpcClient.search.recall.query.mockResolvedValue(emptyResult);

    await createProgram().parseAsync([
      'node',
      'test',
      'recall',
      'STAMP',
      '--since',
      '2026-10-12',
      '--until',
      '2026-10-18',
      '-t',
      'goal,message',
      '--exact',
      '--include-system',
      '-L',
      '5',
    ]);

    expect(mockTrpcClient.search.recall.query).toHaveBeenCalledWith({
      endDate: new Date(2026, 9, 18, 23, 59, 59, 999),
      exact: true,
      includeAutomatedPrompts: true,
      limitPerType: 5,
      query: 'STAMP',
      startDate: new Date(2026, 9, 12, 0, 0, 0, 0),
      types: ['goal', 'message'],
    });
    expect(output()).toContain('Nothing found in this window.');
  });

  it('renders each non-empty group', async () => {
    mockTrpcClient.search.recall.query.mockResolvedValue({
      goals: [
        {
          id: 'goal_dTXmv3HgsIYq',
          status: 'paused',
          title: 'Client reads to replica (STAMP)',
          updatedAt: new Date(2026, 9, 18, 10, 0),
        },
      ],
      messages: {
        hasMore: true,
        items: [
          {
            createdAt: new Date(2026, 9, 15, 9, 5),
            id: 'msg_1',
            role: 'user',
            snippet: 'turning on STAMP mode',
            topicTitle: 'Weekly report',
          },
        ],
      },
      pages: [{ id: 'docs_1', title: 'STAMP notes', updatedAt: new Date(2026, 9, 16, 8, 0) }],
      topics: [
        {
          hitCount: 3,
          id: 'tpc_1',
          lastMatchedAt: new Date(2026, 9, 15, 9, 5),
          matchedBy: ['title', 'messages'],
          title: 'Weekly report',
        },
      ],
    });

    await createProgram().parseAsync(['node', 'test', 'recall', 'STAMP']);

    const text = output();
    expect(text).toContain('goal_dTXmv3HgsIYq');
    expect(text).toContain('paused');
    expect(text).toContain('title+messages');
    expect(text).toContain('turning on STAMP mode');
    expect(text).toContain('2026-10-15 09:05');
    expect(text).toContain('docs_1');
    expect(text).toContain('More messages');
  });

  it('keeps the truncation caveat when the window is otherwise empty', async () => {
    mockTrpcClient.search.recall.query.mockResolvedValue({
      ...emptyResult,
      messages: { hasMore: false, items: [], truncated: true },
    });

    await createProgram().parseAsync(['node', 'test', 'recall', 'x', '--exact']);

    expect(output()).toContain('Nothing found in this window.');
    expect(output()).toContain('Only the most relevant message matches were considered');
  });

  it('keeps the truncation caveat when only other sections have results', async () => {
    mockTrpcClient.search.recall.query.mockResolvedValue({
      ...emptyResult,
      goals: [{ id: 'goal_1', status: 'paused', title: 'x goal' }],
      messages: { hasMore: false, items: [], truncated: true },
    });

    await createProgram().parseAsync(['node', 'test', 'recall', 'x']);

    expect(output()).toContain('goal_1');
    expect(output()).toContain('Only the most relevant message matches were considered');
  });

  it('rejects unknown types before calling the server', async () => {
    await createProgram().parseAsync(['node', 'test', 'recall', 'x', '-t', 'goal,agent']);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid type: agent'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.search.recall.query).not.toHaveBeenCalled();
  });

  it('explains when the server predates recall', async () => {
    mockTrpcClient.search.recall.query.mockRejectedValue(
      Object.assign(new Error('No "query"-procedure on path "search.recall"'), {
        data: { code: 'NOT_FOUND' },
      }),
    );

    await createProgram().parseAsync(['node', 'test', 'recall', 'x']);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('does not support recall'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('prints JSON when asked', async () => {
    mockTrpcClient.search.recall.query.mockResolvedValue(emptyResult);

    await createProgram().parseAsync(['node', 'test', 'recall', 'x', '--json']);

    expect(JSON.parse(output())).toEqual(emptyResult);
  });
});
