import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentEvalExternal: {
      datasetGet: { query: vi.fn() },
      messagesList: { query: vi.fn() },
      runGet: { query: vi.fn() },
      runSetStatus: { mutate: vi.fn() },
      runTopicReportResult: { mutate: vi.fn() },
      runTopicsList: { query: vi.fn() },
      testCasesCount: { query: vi.fn() },
      threadsList: { query: vi.fn() },
    },
  },
}));

const { getTrpcClientMock } = vi.hoisted(() => ({
  getTrpcClientMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  getTrpcClient: getTrpcClientMock,
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  setVerbose: vi.fn(),
}));

// eslint-disable-next-line import-x/first
import { log } from '../utils/logger';
// eslint-disable-next-line import-x/first
import { registerEvalCommand } from './eval';

describe('eval command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getTrpcClientMock.mockResolvedValue(mockTrpcClient);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (const method of Object.values(mockTrpcClient.agentEvalExternal)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  const createProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerEvalCommand(program);
    return program;
  };

  it('should call runGet and output json envelope', async () => {
    mockTrpcClient.agentEvalExternal.runGet.query.mockResolvedValue({
      config: { k: 1 },
      datasetId: 'dataset-1',
      id: 'run-1',
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'eval', 'run', 'get', '--run-id', 'run-1', '--json']);

    expect(mockTrpcClient.agentEvalExternal.runGet.query).toHaveBeenCalledWith({ runId: 'run-1' });

    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload).toEqual({
      data: {
        config: { k: 1 },
        datasetId: 'dataset-1',
        id: 'run-1',
      },
      error: null,
      ok: true,
      version: 'v1',
    });
  });

  it('should call datasetGet and output json envelope', async () => {
    mockTrpcClient.agentEvalExternal.datasetGet.query.mockResolvedValue({
      id: 'dataset-1',
      metadata: { preset: 'deepsearchqa' },
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'dataset',
      'get',
      '--dataset-id',
      'dataset-1',
      '--json',
    ]);

    expect(mockTrpcClient.agentEvalExternal.datasetGet.query).toHaveBeenCalledWith({
      datasetId: 'dataset-1',
    });
  });

  it('should pass onlyExternal to runTopicsList', async () => {
    mockTrpcClient.agentEvalExternal.runTopicsList.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'run-topics',
      'list',
      '--run-id',
      'run-1',
      '--only-external',
      '--json',
    ]);

    expect(mockTrpcClient.agentEvalExternal.runTopicsList.query).toHaveBeenCalledWith({
      onlyExternal: true,
      runId: 'run-1',
    });
  });

  it('should pass topicId and threadId to messagesList', async () => {
    mockTrpcClient.agentEvalExternal.messagesList.query.mockResolvedValue([]);

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'messages',
      'list',
      '--topic-id',
      'topic-1',
      '--thread-id',
      'thread-1',
      '--json',
    ]);

    expect(mockTrpcClient.agentEvalExternal.messagesList.query).toHaveBeenCalledWith({
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
  });

  it('should parse and report run-topic result', async () => {
    mockTrpcClient.agentEvalExternal.runTopicReportResult.mutate.mockResolvedValue({
      success: true,
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'run-topic',
      'report-result',
      '--run-id',
      'run-1',
      '--topic-id',
      'topic-1',
      '--thread-id',
      'thread-1',
      '--score',
      '0.91',
      '--correct',
      'true',
      '--result-json',
      '{"grade":"A"}',
      '--json',
    ]);

    expect(mockTrpcClient.agentEvalExternal.runTopicReportResult.mutate).toHaveBeenCalledWith({
      correct: true,
      result: { grade: 'A' },
      runId: 'run-1',
      score: 0.91,
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
  });

  it('should update run status', async () => {
    mockTrpcClient.agentEvalExternal.runSetStatus.mutate.mockResolvedValue({
      runId: 'run-1',
      status: 'completed',
      success: true,
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'run',
      'set-status',
      '--run-id',
      'run-1',
      '--status',
      'completed',
    ]);

    expect(mockTrpcClient.agentEvalExternal.runSetStatus.mutate).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'completed',
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('status updated to'));
  });

  it('should output json error envelope when command fails', async () => {
    const error = Object.assign(new Error('Run not found'), {
      data: { code: 'NOT_FOUND' },
    });
    mockTrpcClient.agentEvalExternal.runGet.query.mockRejectedValue(error);

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'run',
      'get',
      '--run-id',
      'run-404',
      '--json',
    ]);

    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload).toEqual({
      data: null,
      error: { code: 'NOT_FOUND', message: 'Run not found' },
      ok: false,
      version: 'v1',
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should query test case count', async () => {
    mockTrpcClient.agentEvalExternal.testCasesCount.query.mockResolvedValue({ count: 12 });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'eval',
      'test-cases',
      'count',
      '--dataset-id',
      'dataset-1',
      '--json',
    ]);

    expect(mockTrpcClient.agentEvalExternal.testCasesCount.query).toHaveBeenCalledWith({
      datasetId: 'dataset-1',
    });
  });

  it('should log plain error without --json', async () => {
    mockTrpcClient.agentEvalExternal.threadsList.query.mockRejectedValue(new Error('boom'));

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'eval', 'threads', 'list', '--topic-id', 'topic-1']);

    expect(log.error).toHaveBeenCalledWith('boom');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
